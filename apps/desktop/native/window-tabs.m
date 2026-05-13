#import <Cocoa/Cocoa.h>
#import <objc/runtime.h>

static char kGSpotResizePropagatorKey;

static NSString *GSpotString(const char *value) {
  if (value == NULL) {
    return nil;
  }

  return [NSString stringWithUTF8String:value];
}

// Fire the window's resize callbacks (delegate + notification observers).
// Electrobun's autoResize relies on NSWindow resize events to relayout the
// embedded BrowserView, but events like the macOS native tab bar appearing
// or the Web Inspector docking only change the contentView's frame without
// triggering windowDidResize:, leaving the view at its old size.
static void GSpotFireWindowResize(NSWindow *window) {
  if (window == nil) {
    return;
  }

  NSNotification *note =
      [NSNotification notificationWithName:NSWindowDidResizeNotification
                                    object:window];
  id<NSWindowDelegate> delegate = window.delegate;
  if ([delegate respondsToSelector:@selector(windowDidResize:)]) {
    [delegate windowDidResize:note];
  }
  [[NSNotificationCenter defaultCenter] postNotification:note];
}

@interface GSpotResizePropagator : NSObject
@property(nonatomic, weak) NSWindow *window;
@property(nonatomic, weak) NSView *observedContentView;
@end

@implementation GSpotResizePropagator

- (void)startObservingWindow:(NSWindow *)window {
  self.window = window;
  [self attachToCurrentContentView];

  // The contentView reference can be swapped (e.g. when entering fullscreen).
  [[NSNotificationCenter defaultCenter]
      addObserver:self
         selector:@selector(handleWindowEvent:)
             name:NSWindowDidEnterFullScreenNotification
           object:window];
  [[NSNotificationCenter defaultCenter]
      addObserver:self
         selector:@selector(handleWindowEvent:)
             name:NSWindowDidExitFullScreenNotification
           object:window];
}

- (void)attachToCurrentContentView {
  NSView *contentView = self.window.contentView;
  if (contentView == self.observedContentView) {
    return;
  }

  [self detachContentView];

  if (contentView == nil) {
    return;
  }

  self.observedContentView = contentView;
  [contentView addObserver:self
                forKeyPath:@"frame"
                   options:NSKeyValueObservingOptionNew
                   context:NULL];
}

- (void)detachContentView {
  NSView *contentView = self.observedContentView;
  if (contentView == nil) {
    return;
  }

  @try {
    [contentView removeObserver:self forKeyPath:@"frame"];
  } @catch (NSException *exception) {
  }
  self.observedContentView = nil;
}

- (void)handleWindowEvent:(NSNotification *)note {
  [self attachToCurrentContentView];
  GSpotFireWindowResize(self.window);
}

- (void)observeValueForKeyPath:(NSString *)keyPath
                      ofObject:(id)object
                        change:(NSDictionary<NSKeyValueChangeKey, id> *)change
                       context:(void *)context {
  if (![keyPath isEqualToString:@"frame"]) {
    return;
  }
  GSpotFireWindowResize(self.window);
}

- (void)dealloc {
  [self detachContentView];
  [[NSNotificationCenter defaultCenter] removeObserver:self];
}

@end

__attribute__((visibility("default")))
void gspot_configure_window_tabbing(void *windowPtr, const char *identifier, long mode) {
  if (windowPtr == NULL) {
    return;
  }

  NSWindow *window = (__bridge NSWindow *)windowPtr;
  NSString *tabbingIdentifier = GSpotString(identifier);

  dispatch_async(dispatch_get_main_queue(), ^{
    if (tabbingIdentifier != nil) {
      [window setTabbingIdentifier:tabbingIdentifier];
    }

    [window setTabbingMode:(NSWindowTabbingMode)mode];
  });
}

__attribute__((visibility("default")))
void gspot_add_tabbed_window(void *anchorPtr, void *windowPtr, long orderingMode) {
  if (anchorPtr == NULL || windowPtr == NULL) {
    return;
  }

  NSWindow *anchor = (__bridge NSWindow *)anchorPtr;
  NSWindow *window = (__bridge NSWindow *)windowPtr;

  dispatch_async(dispatch_get_main_queue(), ^{
    [anchor addTabbedWindow:window ordered:(NSWindowOrderingMode)orderingMode];
    [window makeKeyAndOrderFront:nil];

    // Adding a window to a tab group changes the anchor's contentView frame
    // (the tab bar appears) but does not emit windowDidResize:. Nudge the
    // resize pipeline so electrobun relayouts the embedded BrowserView.
    GSpotFireWindowResize(anchor);
    GSpotFireWindowResize(window);
  });
}

__attribute__((visibility("default")))
void gspot_perform_window_selector(void *windowPtr, const char *selectorName) {
  if (windowPtr == NULL || selectorName == NULL) {
    return;
  }

  NSWindow *window = (__bridge NSWindow *)windowPtr;
  NSString *selectorString = GSpotString(selectorName);

  dispatch_async(dispatch_get_main_queue(), ^{
    SEL selector = NSSelectorFromString(selectorString);
    if (selector != NULL && [window respondsToSelector:selector]) {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Warc-performSelector-leaks"
      [window performSelector:selector];
#pragma clang diagnostic pop
    }
    // Tab-bar toggling, tab moves, and merges all reshape the contentView
    // without emitting windowDidResize:.
    GSpotFireWindowResize(window);
  });
}

__attribute__((visibility("default")))
void gspot_install_resize_propagator(void *windowPtr) {
  if (windowPtr == NULL) {
    return;
  }

  NSWindow *window = (__bridge NSWindow *)windowPtr;

  dispatch_async(dispatch_get_main_queue(), ^{
    GSpotResizePropagator *existing =
        objc_getAssociatedObject(window, &kGSpotResizePropagatorKey);
    if (existing != nil) {
      return;
    }

    GSpotResizePropagator *propagator = [[GSpotResizePropagator alloc] init];
    [propagator startObservingWindow:window];
    objc_setAssociatedObject(window, &kGSpotResizePropagatorKey, propagator,
                             OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  });
}

__attribute__((visibility("default")))
void gspot_force_window_resize(void *windowPtr) {
  if (windowPtr == NULL) {
    return;
  }

  NSWindow *window = (__bridge NSWindow *)windowPtr;
  dispatch_async(dispatch_get_main_queue(), ^{
    GSpotFireWindowResize(window);
  });
}
