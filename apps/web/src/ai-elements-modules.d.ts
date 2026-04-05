// Type declarations for optional AI Elements dependencies
// These modules are only used by AI Element components that may not be
// actively imported, but tsc still checks their types.

declare module "@xyflow/react" {
  import type { ComponentType, SVGAttributes } from "react";
  export type ReactFlowProps = Record<string, unknown>;
  export type NodeProps = Record<string, unknown>;
  export type EdgeProps = Record<string, unknown>;
  export type ConnectionLineComponentProps = {
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    fromPosition: string;
    toPosition: string;
  };
  export type ConnectionLineComponent = ComponentType<ConnectionLineComponentProps>;
  export type InternalNode<T = any> = { internals: { handleBounds?: Record<string, any[]>; positionAbsolute: { x: number; y: number } } } & T;
  export type PanelProps = { className?: string; [key: string]: any };
  export type ControlsProps = { className?: string; [key: string]: any };
  export type MiniMapProps = Record<string, unknown>;
  export const ReactFlow: ComponentType<ReactFlowProps>;
  export const Handle: ComponentType<Record<string, unknown>>;
  export const Panel: ComponentType<PanelProps>;
  export const Controls: ComponentType<ControlsProps>;
  export const MiniMap: ComponentType<MiniMapProps>;
  export const NodeToolbar: ComponentType<{ className?: string; position?: any; [key: string]: any }>;
  export const Background: ComponentType<Record<string, unknown>>;
  export const BaseEdge: ComponentType<Record<string, unknown>>;
  export function getBezierPath(params: Record<string, unknown>): [string, number, number];
  export function getSimpleBezierPath(params: Record<string, unknown>): [string, number, number];
  export function useReactFlow(): Record<string, unknown>;
  export function useInternalNode(id: string): InternalNode | undefined;
  export type Position = string;
  export const Position: Record<string, Position>;
  export const MarkerType: Record<string, string>;
  export type Edge = Record<string, unknown>;
  export type Node = Record<string, unknown>;
}

declare module "media-chrome/react" {
  import type { ComponentType } from "react";
  type MediaProps = { className?: string; [key: string]: any };
  export const MediaController: ComponentType<MediaProps>;
  export const MediaPlayButton: ComponentType<MediaProps>;
  export const MediaTimeRange: ComponentType<MediaProps>;
  export const MediaTimeDisplay: ComponentType<MediaProps>;
  export const MediaVolumeRange: ComponentType<MediaProps>;
  export const MediaMuteButton: ComponentType<MediaProps>;
  export const MediaPlaybackRateButton: ComponentType<MediaProps>;
  export const MediaSeekBackwardButton: ComponentType<MediaProps>;
  export const MediaSeekForwardButton: ComponentType<MediaProps>;
  export const MediaControlBar: ComponentType<MediaProps>;
  export const MediaDurationDisplay: ComponentType<MediaProps>;
}

declare module "react-jsx-parser" {
  import type { ComponentType } from "react";
  export interface TProps {
    jsx: string;
    components?: Record<string, ComponentType<any>>;
    renderInWrapper?: boolean;
    [key: string]: unknown;
  }
  export type JsxParserProps = TProps;
  const JsxParser: ComponentType<TProps>;
  export default JsxParser;
}

declare module "@rive-app/react-webgl2" {
  import type { ComponentType } from "react";
  export interface RiveParameters {
    onLoad?: (rive: any) => void;
    onLoadError?: (err: any) => void;
    onPause?: (event: any) => void;
    onPlay?: (event: any) => void;
    onStop?: (event: any) => void;
    [key: string]: unknown;
  }
  export interface UseRiveOptions {
    src?: string;
    stateMachines?: string;
    autoplay?: boolean;
    onLoad?: any;
    onLoadError?: any;
    onPause?: any;
    onPlay?: any;
    onRiveReady?: any;
    onStop?: any;
    [key: string]: unknown;
  }
  export interface RiveState {
    rive: any;
    RiveComponent: ComponentType<Record<string, unknown>>;
  }
  export function useRive(options: UseRiveOptions | null): RiveState;
  export function useStateMachineInput(...args: any[]): any;
  export function useViewModel(...args: any[]): any;
  export function useViewModelInstance(...args: any[]): any;
  export function useViewModelInstanceColor(...args: any[]): any;
  export const Alignment: Record<string, unknown>;
  export const Fit: Record<string, unknown>;
  export const Layout: new (...args: any[]) => unknown;
}

declare module "ansi-to-react" {
  import type { ComponentType } from "react";
  const Ansi: ComponentType<{ children?: string; [key: string]: unknown }>;
  export default Ansi;
}
