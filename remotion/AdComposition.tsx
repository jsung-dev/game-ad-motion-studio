import React, { useEffect, useState } from "react";
import {
  AbsoluteFill,
  continueRender,
  delayRender,
  Easing,
  interpolate,
  Html5Video,
  Img,
  OffthreadVideo,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useRemotionEnvironment,
  useVideoConfig,
} from "remotion";
import {
  DEFAULT_OUTPUT_RATIO,
  OUTPUT_FPS,
  type GraphicItem,
  type TextItem,
  type VideoAdCompositionProps,
  type VideoAdSequenceCompositionProps,
} from "../lib/video-ad/types";

const FontLoader: React.FC = () => {
  const [handle] = useState(() => delayRender("Noto Sans KR 글꼴을 불러오는 중입니다."));

  useEffect(() => {
    const ready = async () => {
      try {
        await document.fonts.load('900 48px "Noto Sans KR"');
        await document.fonts.ready;
      } finally {
        continueRender(handle);
      }
    };
    void ready();
  }, [handle]);

  return <link rel="stylesheet" href={staticFile("fonts/noto-sans-kr-900.css")} />;
};

const AnimatedText: React.FC<{ item: TextItem }> = ({ item }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const verticalPadding = Math.round(height * 0.09);
  const positionStyle: Record<TextItem["position"], React.CSSProperties> = {
    top: { justifyContent: "flex-start", paddingTop: verticalPadding },
    center: { justifyContent: "center", paddingTop: verticalPadding, paddingBottom: verticalPadding },
    bottom: { justifyContent: "flex-end", paddingBottom: verticalPadding },
  };
  const startFrame = Math.round(item.start * fps);
  const endFrame = Math.round(item.end * fps);
  const localFrame = frame - startFrame;
  const totalFrames = Math.max(1, endFrame - startFrame);

  if (localFrame < 0 || localFrame >= totalFrames) return null;

  const transitionFrames = Math.max(
    1,
    Math.min(Math.round(fps * 0.3), Math.floor(Math.max(1, totalFrames - 1) / 2)),
  );
  const exitStart = Math.max(transitionFrames, totalFrames - transitionFrames - 1);
  const entering = interpolate(localFrame, [0, transitionFrames], [0, 1], {
    easing: Easing.out(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const leaving = interpolate(localFrame, [exitStart, totalFrames - 1], [1, 0], {
    easing: Easing.in(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const shortDuration = totalFrames <= transitionFrames * 2 + 2;
  const opacity =
    item.motion === "none"
      ? 1
      : shortDuration
        ? Math.max(0.78, Math.min(entering, leaving))
        : Math.min(entering, leaving);

  let transform = "translate3d(0, 0, 0)";
  if (item.motion === "pop") {
    const pop = spring({
      frame: Math.min(localFrame, transitionFrames * 2),
      fps,
      config: { damping: 11, stiffness: 205, mass: 0.72 },
    });
    const enteredScale = interpolate(pop, [0, 1], [0.62, 1]);
    const leavingScale = interpolate(leaving, [0, 1], [0.94, 1]);
    transform = `translate3d(0, 0, 0) scale(${Math.min(1.12, enteredScale * leavingScale)})`;
  }
  if (item.motion === "slide-up") {
    const y = 86 * (1 - entering) - 12 * (1 - leaving);
    transform = `translate3d(0, ${y}px, 0)`;
  }

  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        paddingLeft: Math.round(width * 0.075),
        paddingRight: Math.round(width * 0.075),
        pointerEvents: "none",
        ...positionStyle[item.position],
      }}
    >
      <div
        style={{
          maxWidth: Math.round(width * 0.85),
          color: item.color,
          fontFamily: '"Noto Sans KR", Arial, sans-serif',
          fontWeight: 900,
          fontSize: item.fontSize,
          lineHeight: 1.17,
          letterSpacing: -Math.min(2.4, item.fontSize * 0.025),
          textAlign: "center",
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
          wordBreak: "keep-all",
          WebkitTextStroke: `${item.strokeWidth}px ${item.strokeColor}`,
          paintOrder: "stroke fill",
          textShadow: item.shadow ? "0 8px 18px rgba(0, 0, 0, 0.68)" : "none",
          opacity,
          transform,
        }}
      >
        {item.text}
      </div>
    </AbsoluteFill>
  );
};

const AnimatedGraphic: React.FC<{ item: GraphicItem }> = ({ item }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const startFrame = Math.round(item.start * fps);
  const endFrame = Math.round(item.end * fps);
  const localFrame = frame - startFrame;
  const totalFrames = Math.max(1, endFrame - startFrame);
  if (localFrame < 0 || localFrame >= totalFrames) return null;

  const transitionFrames = Math.max(1, Math.min(Math.round(fps * 0.3), Math.floor(Math.max(1, totalFrames - 1) / 2)));
  const exitStart = Math.max(transitionFrames, totalFrames - transitionFrames - 1);
  const entering = interpolate(localFrame, [0, transitionFrames], [0, 1], {
    easing: Easing.out(Easing.cubic), extrapolateLeft: "clamp", extrapolateRight: "clamp",
  });
  const leaving = interpolate(localFrame, [exitStart, totalFrames - 1], [1, 0], {
    easing: Easing.in(Easing.cubic), extrapolateLeft: "clamp", extrapolateRight: "clamp",
  });
  const shortDuration = totalFrames <= transitionFrames * 2 + 2;
  const opacity = item.motion === "none" ? 1 : shortDuration ? Math.max(0.78, Math.min(entering, leaving)) : Math.min(entering, leaving);

  let motionTransform = "translate3d(0, 0, 0)";
  if (item.motion === "pop") {
    const pop = spring({ frame: Math.min(localFrame, transitionFrames * 2), fps, config: { damping: 11, stiffness: 205, mass: 0.72 } });
    const enteredScale = interpolate(pop, [0, 1], [0.62, 1]);
    const leavingScale = interpolate(leaving, [0, 1], [0.94, 1]);
    motionTransform = `translate3d(0, 0, 0) scale(${Math.min(1.12, enteredScale * leavingScale)})`;
  }
  if (item.motion === "slide-up") {
    const y = 86 * (1 - entering) - 12 * (1 - leaving);
    motionTransform = `translate3d(0, ${y}px, 0)`;
  }

  return (
    <Img
      src={item.sourceUrl}
      style={{
        position: "absolute",
        left: `${item.xPercent}%`,
        top: `${item.yPercent}%`,
        width: `${item.widthPercent}%`,
        height: "auto",
        opacity,
        transform: `translate(-50%, -50%) ${motionTransform}`,
        transformOrigin: "center",
        filter: item.shadow ? "drop-shadow(0 8px 14px rgba(0, 0, 0, 0.62))" : "none",
      }}
    />
  );
};

const VideoAdClip: React.FC<Pick<VideoAdCompositionProps, "videoSrc" | "items" | "graphics" | "aspectMode">> = ({
  videoSrc,
  items,
  graphics,
  aspectMode,
}) => {
  const { isPlayer } = useRemotionEnvironment();
  const videoStyle: React.CSSProperties = {
    width: "100%",
    height: "100%",
    objectFit: aspectMode === "cover" ? "cover" : "contain",
  };
  return (
    <AbsoluteFill style={{ backgroundColor: "#000000", overflow: "hidden" }}>
      {isPlayer ? (
        <Html5Video src={videoSrc} pauseWhenBuffering preload="auto" style={videoStyle} />
      ) : (
        <OffthreadVideo src={videoSrc} pauseWhenBuffering style={videoStyle} />
      )}
      {graphics.map((item) => (
        <AnimatedGraphic key={item.id} item={item} />
      ))}
      {items.map((item) => (
        <AnimatedText key={item.id} item={item} />
      ))}
    </AbsoluteFill>
  );
};

export const VideoAdComposition: React.FC<VideoAdCompositionProps> = (props) => (
  <AbsoluteFill style={{ backgroundColor: "#000000", overflow: "hidden" }}>
    <FontLoader />
    <VideoAdClip {...props} />
  </AbsoluteFill>
);

export const VideoAdSequenceComposition: React.FC<VideoAdSequenceCompositionProps> = ({
  clips,
  items,
  graphics,
  aspectMode,
}) => {
  let from = 0;

  return (
    <AbsoluteFill style={{ backgroundColor: "#000000", overflow: "hidden" }}>
      <FontLoader />
      {clips.map((clip) => {
        const durationInFrames = clip.durationInFrames;
        const sequenceFrom = from;
        from += durationInFrames;
        return (
          <Sequence
            key={clip.id}
            from={sequenceFrom}
            durationInFrames={durationInFrames}
            premountFor={sequenceFrom}
          >
            <VideoAdClip
              videoSrc={clip.videoSrc}
              items={[]}
              graphics={clip.graphics}
              aspectMode={aspectMode}
            />
          </Sequence>
        );
      })}
      {items.map((item) => (
        <AnimatedText key={item.id} item={item} />
      ))}
      {graphics.map((item) => (
        <AnimatedGraphic key={item.id} item={item} />
      ))}
    </AbsoluteFill>
  );
};

export const DEFAULT_COMPOSITION_PROPS: VideoAdCompositionProps = {
  videoSrc: "",
  metadata: { duration: 1, width: 720, height: 1280, fps: OUTPUT_FPS, hasAudio: false },
  items: [],
  graphics: [],
  aspectMode: "cover",
  outputRatio: DEFAULT_OUTPUT_RATIO,
};
