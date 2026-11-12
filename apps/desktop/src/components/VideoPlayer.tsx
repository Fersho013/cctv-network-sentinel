import Hls from 'hls.js';
import React, { useEffect, useRef, useState } from 'react';

interface VideoPlayerProps {
  src: string;
  className?: string;
}

/**
 * Reproductor HLS compatible con navegadores (hls.js) y con WebView/Safari
 * que soportan HLS de forma nativa.
 */
export const VideoPlayer: React.FC<VideoPlayerProps> = ({ src, className }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    setError(null);

    if (Hls.isSupported()) {
      const hls = new Hls({
        lowLatencyMode: true,
        liveSyncDurationCount: 2,
        maxLiveSyncPlaybackRate: 1.5,
        manifestLoadingTimeOut: 10_000,
      });

      hls.loadSource(src);
      hls.attachMedia(video);

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;

        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
          return;
        }

        setError('Se perdió la señal de vídeo. Reintentando…');
        hls.destroy();
      });

      void video.play().catch(() => undefined);

      return () => hls.destroy();
    }

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
      void video.play().catch(() => undefined);
      return () => {
        video.removeAttribute('src');
        video.load();
      };
    }

    setError('Este navegador no soporta reproducción HLS.');
    return undefined;
  }, [src]);

  return (
    <div className={`relative bg-black ${className ?? ''}`}>
      <video
        ref={videoRef}
        controls
        autoPlay
        muted
        playsInline
        className="h-full w-full object-contain"
      />
      {error && (
        <div className="absolute inset-x-0 bottom-0 bg-red-950/80 px-3 py-2 text-xs text-red-200">
          {error}
        </div>
      )}
    </div>
  );
};

export default VideoPlayer;
