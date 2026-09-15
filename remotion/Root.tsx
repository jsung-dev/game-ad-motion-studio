import React from "react";
import { Composition } from "remotion";
import { getDurationInFrames } from "../lib/video-ad/validation";
import { getOutputDimensions, OUTPUT_FPS, OUTPUT_HEIGHT, OUTPUT_WIDTH, type VideoAdCompositionProps, type VideoAdSequenceCompositionProps } from "../lib/video-ad/types";
import {
  DEFAULT_COMPOSITION_PROPS,
  VideoAdComposition,
  VideoAdSequenceComposition,
} from "./AdComposition";

const DEFAULT_SEQUENCE_PROPS = {
  clips: [],
  items: [],
  graphics: [],
  aspectMode: "cover" as const,
  outputRatio: "9:16" as const,
};

export const RemotionRoot: React.FC = () => {
  return (
    <>
    <Composition
      id="VideoAd"
      component={VideoAdComposition}
      width={OUTPUT_WIDTH}
      height={OUTPUT_HEIGHT}
      fps={OUTPUT_FPS}
      durationInFrames={OUTPUT_FPS}
      defaultProps={DEFAULT_COMPOSITION_PROPS}
      calculateMetadata={({ props }: { props: VideoAdCompositionProps }) => {
        const { width, height } = getOutputDimensions(props.outputRatio);
        return {
          durationInFrames: getDurationInFrames(props.metadata.duration),
          width,
          height,
        };
      }}
    />
    <Composition
      id="VideoAdSequence"
      component={VideoAdSequenceComposition}
      width={OUTPUT_WIDTH}
      height={OUTPUT_HEIGHT}
      fps={OUTPUT_FPS}
      durationInFrames={OUTPUT_FPS}
      defaultProps={DEFAULT_SEQUENCE_PROPS}
      calculateMetadata={({ props }: { props: VideoAdSequenceCompositionProps }) => {
        const { width, height } = getOutputDimensions(props.outputRatio);
        return {
          durationInFrames: Math.max(
            1,
            props.clips.reduce((sum, clip) => sum + clip.durationInFrames, 0),
          ),
          width,
          height,
        };
      }}
    />
    </>
  );
};
