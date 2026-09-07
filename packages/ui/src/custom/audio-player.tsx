"use client";

import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "../lib/utils.js";
import { Button } from "../primitives/button.js";
import { Slider } from "../primitives/slider.js";

export interface AudioPlayerProps {
  src: string;
  stereoSrc?: string;
  duration?: number;
  onTimeUpdate?: (seconds: number) => void;
  className?: string;
}

const SPEEDS = [1, 1.25, 1.5, 2];

/** Recording playback: stereo/dual-channel toggle, waveform placeholder, seek, speed — call detail (FRONTEND_SPEC.md §1.3/§6.3). */
export function AudioPlayer({
  src,
  stereoSrc,
  duration,
  onTimeUpdate,
  className,
}: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [total, setTotal] = useState(duration ?? 0);
  const [speedIndex, setSpeedIndex] = useState(0);
  const [stereo, setStereo] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.playbackRate = SPEEDS[speedIndex] ?? 1;
  }, [speedIndex]);

  const activeSrc = stereo && stereoSrc ? stereoSrc : src;

  return (
    <div className={cn("space-y-2 rounded-lg border border-border p-3", className)}>
      {/* biome-ignore lint/a11y/useMediaCaption: call recording has no WebVTT track; the synced transcript is rendered separately via TranscriptViewer */}
      <audio
        ref={audioRef}
        src={activeSrc}
        onTimeUpdate={(e) => {
          const t = e.currentTarget.currentTime;
          setCurrent(t);
          onTimeUpdate?.(t);
        }}
        onLoadedMetadata={(e) => setTotal(e.currentTarget.duration)}
        onEnded={() => setPlaying(false)}
      />
      <div className="flex items-center gap-3">
        <Button
          size="icon"
          variant="outline"
          onClick={() => {
            const audio = audioRef.current;
            if (!audio) return;
            if (playing) audio.pause();
            else void audio.play();
            setPlaying(!playing);
          }}
        >
          {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
        </Button>
        <div className="flex-1">
          <Slider
            value={[current]}
            max={total || 1}
            step={0.5}
            onValueChange={([value]) => {
              const audio = audioRef.current;
              if (audio && value !== undefined) audio.currentTime = value;
            }}
          />
        </div>
        <span className="w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
          {formatTime(current)} / {formatTime(total)}
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setSpeedIndex((i) => (i + 1) % SPEEDS.length)}
        >
          {SPEEDS[speedIndex]}x
        </Button>
        {stereoSrc && (
          <Button
            size="sm"
            variant={stereo ? "default" : "outline"}
            onClick={() => setStereo((s) => !s)}
          >
            Stereo
          </Button>
        )}
      </div>
    </div>
  );
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
