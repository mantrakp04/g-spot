#import <Cocoa/Cocoa.h>

static NSString *GSpotString(const char *value) {
  if (value == NULL) {
    return nil;
  }

  return [NSString stringWithUTF8String:value];
}

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
  });
}
