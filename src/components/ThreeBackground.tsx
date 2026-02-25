import { useRef, useEffect, useCallback } from "react";

/* ────────────────────────────────────────────────
   Canvas-based interactive dot grid with
   cursor displacement — the "Antigravity" effect.
   
   Each dot has a home position and gets pushed/pulled
   by the cursor, creating a ripple/magnetic field.
   Connected lines form between nearby displaced dots.
   ──────────────────────────────────────────────── */

interface Dot {
  homeX: number;
  homeY: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

const ThreeBackground: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({ x: -9999, y: -9999 });
  const dotsRef = useRef<Dot[]>([]);
  const animRef = useRef<number>(0);
  const dprRef = useRef(1);

  const MOUSE_RADIUS = 180; // px radius of cursor influence
  const MOUSE_STRENGTH = 45; // how far dots get pushed
  const SPRING = 0.04; // how fast dots return home
  const DAMPING = 0.85; // velocity damping
  const DOT_SPACING = 38; // grid spacing in px
  const DOT_RADIUS = 1.6; // dot size
  const LINE_DIST = 55; // max distance for connections
  const DOT_COLOR = "107, 128, 53"; // olive green RGB
  const LINE_COLOR = "107, 128, 53";

  const initDots = useCallback((width: number, height: number) => {
    const dots: Dot[] = [];
    const cols = Math.ceil(width / DOT_SPACING) + 2;
    const rows = Math.ceil(height / DOT_SPACING) + 2;
    const offsetX = (width - (cols - 1) * DOT_SPACING) / 2;
    const offsetY = (height - (rows - 1) * DOT_SPACING) / 2;

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const x = offsetX + col * DOT_SPACING;
        const y = offsetY + row * DOT_SPACING;
        dots.push({
          homeX: x,
          homeY: y,
          x,
          y,
          vx: 0,
          vy: 0,
          radius: DOT_RADIUS,
        });
      }
    }
    dotsRef.current = dots;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d", { alpha: true })!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    dprRef.current = dpr;

    const resize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      initDots(w, h);
    };

    const handleMouseMove = (e: MouseEvent) => {
      mouseRef.current.x = e.clientX;
      mouseRef.current.y = e.clientY;
    };

    const handleMouseLeave = () => {
      mouseRef.current.x = -9999;
      mouseRef.current.y = -9999;
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        mouseRef.current.x = e.touches[0].clientX;
        mouseRef.current.y = e.touches[0].clientY;
      }
    };

    const handleTouchEnd = () => {
      mouseRef.current.x = -9999;
      mouseRef.current.y = -9999;
    };

    const animate = () => {
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      ctx.clearRect(0, 0, w, h);

      const mx = mouseRef.current.x;
      const my = mouseRef.current.y;
      const dots = dotsRef.current;

      // Update physics
      for (const dot of dots) {
        // Cursor displacement
        const dx = dot.x - mx;
        const dy = dot.y - my;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < MOUSE_RADIUS && dist > 0) {
          const force = (MOUSE_RADIUS - dist) / MOUSE_RADIUS;
          const angle = Math.atan2(dy, dx);
          const pushX = Math.cos(angle) * force * MOUSE_STRENGTH * 0.15;
          const pushY = Math.sin(angle) * force * MOUSE_STRENGTH * 0.15;
          dot.vx += pushX;
          dot.vy += pushY;
        }

        // Spring back to home
        const springX = (dot.homeX - dot.x) * SPRING;
        const springY = (dot.homeY - dot.y) * SPRING;
        dot.vx += springX;
        dot.vy += springY;

        // Damping
        dot.vx *= DAMPING;
        dot.vy *= DAMPING;

        // Apply velocity
        dot.x += dot.vx;
        dot.y += dot.vy;
      }

      // Draw connections first (behind dots)
      ctx.lineWidth = 0.5;
      for (let i = 0; i < dots.length; i++) {
        for (let j = i + 1; j < dots.length; j++) {
          const dx = dots[i].x - dots[j].x;
          const dy = dots[i].y - dots[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < LINE_DIST) {
            // Only draw lines near cursor for a localized glow effect
            const midX = (dots[i].x + dots[j].x) / 2;
            const midY = (dots[i].y + dots[j].y) / 2;
            const dxMouse = midX - mx;
            const dyMouse = midY - my;
            const distMouse = Math.sqrt(dxMouse * dxMouse + dyMouse * dyMouse);

            if (distMouse < MOUSE_RADIUS * 1.4) {
              const lineOpacity =
                (1 - dist / LINE_DIST) *
                (1 - distMouse / (MOUSE_RADIUS * 1.4)) *
                0.35;
              ctx.strokeStyle = `rgba(${LINE_COLOR}, ${lineOpacity})`;
              ctx.beginPath();
              ctx.moveTo(dots[i].x, dots[i].y);
              ctx.lineTo(dots[j].x, dots[j].y);
              ctx.stroke();
            }
          }
        }
      }

      // Draw dots
      for (const dot of dots) {
        // Distance from home determines "active" state
        const displaceDist = Math.sqrt(
          (dot.x - dot.homeX) ** 2 + (dot.y - dot.homeY) ** 2,
        );
        const activity = Math.min(displaceDist / 15, 1);

        // Base opacity + cursor proximity boost
        const dxM = dot.x - mx;
        const dyM = dot.y - my;
        const distM = Math.sqrt(dxM * dxM + dyM * dyM);
        const cursorProximity =
          distM < MOUSE_RADIUS ? 1 - distM / MOUSE_RADIUS : 0;

        const baseOpacity = 0.12;
        const opacity = baseOpacity + activity * 0.3 + cursorProximity * 0.4;
        const radius = dot.radius + activity * 1.2 + cursorProximity * 1.5;

        ctx.fillStyle = `rgba(${DOT_COLOR}, ${opacity})`;
        ctx.beginPath();
        ctx.arc(dot.x, dot.y, radius, 0, Math.PI * 2);
        ctx.fill();
      }

      animRef.current = requestAnimationFrame(animate);
    };

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseleave", handleMouseLeave);
    window.addEventListener("touchmove", handleTouchMove, { passive: true });
    window.addEventListener("touchend", handleTouchEnd);
    animRef.current = requestAnimationFrame(animate);

    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseleave", handleMouseLeave);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
      cancelAnimationFrame(animRef.current);
    };
  }, [initDots]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        zIndex: -1,
        pointerEvents: "none",
      }}
    />
  );
};

export default ThreeBackground;
