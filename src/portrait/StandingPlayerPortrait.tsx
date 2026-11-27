import { useEffect, useRef, useState } from 'react';
import type { EquipmentLoadout } from '../equipment/contract.mts';
import { usePreferences } from '../PreferencesProvider';
import { standing } from './nugwaAnimation';
import { loadPortraitSkin } from './playPortrait';
import { cameraYaw, stageHeight, stageWidth } from './portraitScene';
import { createPortraitRenderer } from './renderPortrait';
import type { PortraitSkin, SkinPose } from './skinGeometry';

const portraitWidth = 112;
const armorSamplesPerAxis = 2;
const followTime = 28;
const lookTolerance = 0.0005;

export function StandingPlayerPortrait({ name, server, slots }: {
  name: string; server: string; slots?: EquipmentLoadout['slots'];
}) {
  const { text } = usePreferences();
  const canvas = useRef<HTMLCanvasElement>(null);
  const draw = useRef<() => void>(undefined);
  const drawArmor = useRef<(horizontal: number, vertical: number) => HTMLCanvasElement>(undefined);
  const look = useRef({ horizontal: 0, vertical: 0 });
  const [skin, setSkin] = useState<PortraitSkin>();
  const [result, setResult] = useState<'ready' | 'unavailable'>();

  useEffect(() => {
    const request = new AbortController();
    const context = canvas.current?.getContext('2d');
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let cleanup = () => {};
    void (async () => {
      try {
        if (!context) throw new Error('Canvas is unavailable');
        context.imageSmoothingQuality = 'high';
        const skin = await loadPortraitSkin(name, request.signal, true);
        if (request.signal.aborted) return;
        const frame = context.createImageData(stageWidth, stageHeight);
        const render = createPortraitRenderer(new Map([[name, skin]]));
        const renderLook = () => {
          const { horizontal, vertical } = look.current;
          if (drawArmor.current) {
            const armor = drawArmor.current(horizontal, vertical);
            context.clearRect(0, 0, portraitWidth, stageHeight);
            context.drawImage(armor, 0, 0, portraitWidth, stageHeight);
            return;
          }
          const [top, neck] = standing.head;
          const pitch = vertical * 0.42;
          const height = neck[1] - top[1];
          const pose: SkinPose = {
            ...standing,
            headYaw: horizontal * 0.23,
            head: [[top[0], neck[1] - Math.cos(pitch) * height, top[2] + Math.sin(pitch) * height], neck],
          };
          render({ actors: [{ player: name, pose, yaw: cameraYaw + horizontal * 0.36, x: stageWidth / 2 }] }, frame);
          context.putImageData(frame, (portraitWidth - stageWidth) / 2, 0);
        };
        draw.current = renderLook;
        let nextFrame: number | undefined;
        let lastFrame: number | undefined;
        let target = look.current;
        function animateLook(time: number) {
          nextFrame = undefined;
          const elapsed = lastFrame === undefined ? 1000 / 60 : time - lastFrame;
          const step = 1 - Math.exp(-elapsed / followTime);
          const horizontal = look.current.horizontal + (target.horizontal - look.current.horizontal) * step;
          const vertical = look.current.vertical + (target.vertical - look.current.vertical) * step;
          if (Math.abs(target.horizontal - horizontal) > lookTolerance || Math.abs(target.vertical - vertical) > lookTolerance) {
            look.current = { horizontal, vertical };
            lastFrame = time;
            nextFrame = requestAnimationFrame(animateLook);
          } else {
            look.current = target;
            lastFrame = undefined;
          }
          renderLook();
        }
        function stopAnimation() {
          if (nextFrame !== undefined) cancelAnimationFrame(nextFrame);
          nextFrame = undefined;
          lastFrame = undefined;
        }
        function follow(event: PointerEvent) {
          if (event.pointerType !== 'mouse' || motion.matches) return;
          target = {
            horizontal: 2 * event.clientX / window.innerWidth - 1,
            vertical: 2 * event.clientY / window.innerHeight - 1,
          };
          if (nextFrame === undefined) nextFrame = requestAnimationFrame(animateLook);
        }
        function reset() {
          stopAnimation();
          target = { horizontal: 0, vertical: 0 };
          look.current = target;
          renderLook();
        }
        function leavePage(event: PointerEvent) {
          if (event.pointerType === 'mouse' && event.relatedTarget === null) reset();
        }
        reset();
        window.addEventListener('pointermove', follow);
        window.addEventListener('pointerout', leavePage);
        window.addEventListener('blur', reset);
        motion.addEventListener('change', reset);
        cleanup = () => {
          draw.current = undefined;
          stopAnimation();
          window.removeEventListener('pointermove', follow);
          window.removeEventListener('pointerout', leavePage);
          window.removeEventListener('blur', reset);
          motion.removeEventListener('change', reset);
        };
        setSkin(skin);
        setResult('ready');
      } catch {
        if (!request.signal.aborted) setResult('unavailable');
      }
    })();
    return () => {
      request.abort();
      cleanup();
    };
  }, [name]);

  useEffect(() => {
    if (!skin || !slots) return;
    const target = document.createElement('canvas');
    target.width = portraitWidth * armorSamplesPerAxis;
    target.height = stageHeight * armorSamplesPerAxis;
    const request = new AbortController();
    let dispose: (() => void) | undefined;
    const fallBack = () => {
      drawArmor.current = undefined;
      draw.current?.();
    };
    target.addEventListener('webglcontextlost', fallBack);
    void import('../equipment/armorPreview').then(({ loadArmorPreview }) =>
      request.signal.aborted ? undefined : loadArmorPreview(target, server, name, skin, slots, request.signal),
    ).then(scene => {
      if (!scene) return;
      if (request.signal.aborted) {
        scene.dispose();
        return;
      }
      dispose = () => scene.dispose();
      drawArmor.current = (horizontal, vertical) => {
        // Armor geometry faces the viewer along the negative Z axis.
        scene.draw(-horizontal * 24, 8 + vertical * 12);
        return target;
      };
      draw.current?.();
    }).catch(() => { if (!request.signal.aborted) fallBack(); });
    return () => {
      request.abort();
      target.removeEventListener('webglcontextlost', fallBack);
      fallBack();
      dispose?.();
    };
  }, [name, server, skin, slots]);

  return <div className="equipment-portrait">
    <canvas ref={canvas} aria-hidden={result !== 'ready'} width={portraitWidth} height={stageHeight}
      role="img" aria-label={text.portraitCharacter(name)} />
    {result === 'unavailable' && <span>{text.portraitSkinUnavailable}</span>}
  </div>;
}
