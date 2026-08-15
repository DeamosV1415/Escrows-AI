import { useState, useRef } from "react";
import "./IntroVideo.css";
import demoVideo from "../assets/Demo_Video.mp4";

const IntroVideo: React.FC = () => {
  const [isPlaying, setIsPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const handlePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  return (
    <section className="intro-video" id="about">
      <div className="container">
        <div className="intro-video__wrapper scale-in">
          <div className="intro-video__frame">
            <video
              ref={videoRef}
              className="intro-video__video"
              src={demoVideo}
              controls
              muted
              loop
              playsInline
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
            />
            {!isPlaying && (
              <div className="intro-video__overlay" onClick={handlePlay}>
                <div className="intro-video__play-btn">
                  <svg
                    width="32"
                    height="32"
                    viewBox="0 0 24 24"
                    fill="var(--olive-700)"
                    stroke="none"
                  >
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                </div>
                <span className="intro-video__label">
                  Watch How <span className="brand-name">Tachikiba</span> Works
                </span>
              </div>
            )}
            <div className="intro-video__gradient-border"></div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default IntroVideo;
