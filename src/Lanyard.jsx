/* eslint-disable react/no-unknown-property */
// BUILD: LANYARD-NATIVE-CURSOR-BRIDGE-V6 / 2026-09-18
"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, extend, useFrame } from "@react-three/fiber";
import {
  useGLTF,
  useTexture,
  Environment,
  Lightformer,
} from "@react-three/drei";
import {
  BallCollider,
  CuboidCollider,
  Physics,
  RigidBody,
  useRopeJoint,
  useSphericalJoint,
} from "@react-three/rapier";
import { MeshLineGeometry, MeshLineMaterial } from "meshline";

// replace with your own imports, see the usage snippet for details
import cardGLB from "./card.glb";
import lanyard from "./lanyard.png";

import * as THREE from "three";
import "./Lanyard.css";

extend({ MeshLineGeometry, MeshLineMaterial });

const KEYWORD_BRIDGE_CHANNEL = "IMWEB_KEYWORD_BRIDGE";
const CURSOR_BRIDGE_CHANNEL = "IMWEB_CURSOR_BRIDGE";
const CURSOR_BRIDGE_QUERY = "imwebCursor";
const CURSOR_BRIDGE_VALUE = "common";
const MAX_DRAG_STEP = 0.3;
const COMMON_NATIVE_CURSOR =
  `url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='8'%20height='8'%20viewBox='0%200%208%208'%3E%3Crect%20width='8'%20height='8'%20fill='%23F8F9F6'/%3E%3C/svg%3E") 4 4, auto`;

let cachedParentOrigin;
let cachedCursorMode;

function getParentOrigin() {
  if (cachedParentOrigin !== undefined) return cachedParentOrigin;

  if (typeof document === "undefined" || !document.referrer) return "*";

  try {
    cachedParentOrigin = new URL(document.referrer).origin;
  } catch {
    cachedParentOrigin = "*";
  }

  return cachedParentOrigin;
}

function getCursorMode() {
  if (cachedCursorMode !== undefined) return cachedCursorMode;

  cachedCursorMode =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get(CURSOR_BRIDGE_QUERY) ===
      CURSOR_BRIDGE_VALUE
      ? "common"
      : "contact";

  return cachedCursorMode;
}

function getCursorPointerSnapshot(event) {
  const nativeEvent = event?.nativeEvent || event;
  let sample = nativeEvent;

  if (typeof nativeEvent?.getCoalescedEvents === "function") {
    const coalescedEvents = nativeEvent.getCoalescedEvents();
    if (coalescedEvents.length) {
      sample = coalescedEvents[coalescedEvents.length - 1];
    }
  }

  return {
    clientX: sample?.clientX ?? nativeEvent?.clientX ?? 0,
    clientY: sample?.clientY ?? nativeEvent?.clientY ?? 0,
    pointerId: sample?.pointerId ?? nativeEvent?.pointerId ?? 1,
    pointerType: sample?.pointerType ?? nativeEvent?.pointerType ?? "mouse",
    button: sample?.button ?? nativeEvent?.button ?? 0,
    buttons: sample?.buttons ?? nativeEvent?.buttons ?? 0,
  };
}

function sendKeywordPointer(type, event) {
  if (typeof window === "undefined" || window.parent === window) return;

  const nativeEvent = event?.nativeEvent || event;

  window.parent.postMessage(
    {
      channel: KEYWORD_BRIDGE_CHANNEL,
      type,
      x: nativeEvent?.clientX ?? 0,
      y: nativeEvent?.clientY ?? 0,
      pointerId: nativeEvent?.pointerId ?? 1,
      pointerType: nativeEvent?.pointerType ?? "mouse",
      button: nativeEvent?.button ?? 0,
      buttons: nativeEvent?.buttons ?? 0,
    },
    getParentOrigin()
  );
}

function sendCursorPointer(type, event) {
  if (typeof window === "undefined" || window.parent === window) return;

  /*
   * About는 ?imwebCursor=common으로 공통 커서 모드를 사용합니다.
   * 쿼리가 없는 기존 Contact iframe은 contact 모드로 유지됩니다.
   */
  const cursorMode = getCursorMode();
  const pointer = getCursorPointerSnapshot(event);

  /* 커스텀 커서는 마우스 입력에서만 부모 페이지로 전달합니다. */
  if (
    pointer.pointerType &&
    pointer.pointerType !== "mouse"
  ) {
    return;
  }

  window.parent.postMessage(
    {
      channel: CURSOR_BRIDGE_CHANNEL,
      cursorMode,
      cursorTransport: cursorMode === "common" ? "native-css" : "postmessage",
      type,
      x: pointer.clientX,
      y: pointer.clientY,
      pointerId: pointer.pointerId,
      pointerType: pointer.pointerType,
      button: pointer.button,
      buttons: pointer.buttons,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    },
    getParentOrigin()
  );
}

// 1x1 transparent pixel — lets useTexture be called unconditionally when a
// front/back image isn't supplied.
const BLANK_PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

// The card model's front face is UV-mapped to the LEFT half of the texture
// atlas and the back face to the RIGHT half (measured from card.glb). Each
// custom image is composited into its own half so the two faces render
// independently. The atlas rectangles are narrower than the physical card,
// so the drawing step below compensates for that UV-to-mesh transformation.
const FRONT_UV_RECT = { x: 0, y: 0, w: 0.5, h: 0.755 };
const BACK_UV_RECT = { x: 0.5, y: 0, w: 0.5, h: 0.757 };

export default function Lanyard({
  position = [0, 0, 30],
  gravity = [0, -40, 0],
  fov = 20,
  transparent = true,
  frontImage = null,
  backImage = null,
  imageFit = "cover",
  lanyardImage = null,
  lanyardWidth = 1,
  lanyardRepeat = 2,
}) {
  const wrapperRef = useRef(null);
  const interactionRef = useRef({
    cardPointerId: null,
    keywordPointerId: null,
  });

  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.innerWidth < 768
  );

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  /*
   * About의 8px 공통 커서는 iframe 내부에서 네이티브 CSS 커서로 그립니다.
   * pointermove 좌표를 부모로 보내지 않으므로 3D 렌더 프레임과 완전히 분리됩니다.
   * Contact는 기존 postMessage 좌표 브리지를 그대로 유지합니다.
   */
  useEffect(() => {
    const root = document.documentElement;
    const usesNativeCommonCursor =
      getCursorMode() === "common" &&
      window.matchMedia("(pointer: fine)").matches;

    if (usesNativeCommonCursor) {
      const nativeCursorStyle = document.createElement("style");
      let nativeCursorInside = false;

      nativeCursorStyle.dataset.imwebNativeCursor = "v6";
      nativeCursorStyle.textContent = `
        @media (pointer: fine) {
          html,
          body,
          body *,
          .lanyard-wrapper,
          .lanyard-wrapper * {
            cursor: ${COMMON_NATIVE_CURSOR} !important;
          }
        }
      `;
      document.head.appendChild(nativeCursorStyle);

      const handleNativeCursorEnter = (event) => {
        if (nativeCursorInside) return;
        nativeCursorInside = true;
        sendCursorPointer("enter", event);
      };

      const handleNativeCursorMove = (event) => {
        /* effect가 마우스 아래에서 마운트된 경우 최초 1회 진입을 보정합니다. */
        if (!nativeCursorInside) {
          handleNativeCursorEnter(event);
        }
      };

      const handleNativeCursorClick = (event) => {
        sendCursorPointer("click", event);
      };

      const handleNativeCursorLeave = (event) => {
        if (!nativeCursorInside) return;
        nativeCursorInside = false;
        sendCursorPointer("leave", event);
      };

      root.addEventListener("pointerenter", handleNativeCursorEnter, true);
      window.addEventListener("pointermove", handleNativeCursorMove, true);
      window.addEventListener("click", handleNativeCursorClick, true);
      root.addEventListener("pointerleave", handleNativeCursorLeave, true);
      window.addEventListener("blur", handleNativeCursorLeave);

      return () => {
        if (nativeCursorInside) {
          sendCursorPointer("leave", {
            clientX: 0,
            clientY: 0,
            pointerType: "mouse",
          });
        }

        root.removeEventListener("pointerenter", handleNativeCursorEnter, true);
        window.removeEventListener("pointermove", handleNativeCursorMove, true);
        window.removeEventListener("click", handleNativeCursorClick, true);
        root.removeEventListener("pointerleave", handleNativeCursorLeave, true);
        window.removeEventListener("blur", handleNativeCursorLeave);
        nativeCursorStyle.remove();
      };
    }

    let cursorMoveFrame = 0;
    let pendingCursorMove = null;

    const cancelPendingCursorMove = () => {
      if (cursorMoveFrame) {
        window.cancelAnimationFrame(cursorMoveFrame);
        cursorMoveFrame = 0;
      }

      pendingCursorMove = null;
    };

    const flushCursorMove = () => {
      cursorMoveFrame = 0;

      if (!pendingCursorMove) return;

      const pointer = pendingCursorMove;
      pendingCursorMove = null;
      sendCursorPointer("move", pointer);
    };

    const queueCursorMove = (event) => {
      const pointer = getCursorPointerSnapshot(event);
      if (pointer.pointerType !== "mouse") return;

      /*
       * 고주사율 마우스의 수백 개 pointermove를 그대로 postMessage하지 않고
       * 현재 화면 프레임에 필요한 가장 최신 좌표 하나만 부모로 보냅니다.
       */
      pendingCursorMove = pointer;

      if (!cursorMoveFrame) {
        cursorMoveFrame = window.requestAnimationFrame(flushCursorMove);
      }
    };

    const sendCursorImmediately = (type, event) => {
      const pointer = getCursorPointerSnapshot(event);
      if (pointer.pointerType !== "mouse") return;

      cancelPendingCursorMove();
      sendCursorPointer(type, pointer);
    };

    const handleCursorMove = (event) => {
      queueCursorMove(event);
    };

    const handleCursorDown = (event) => {
      sendCursorImmediately("down", event);
    };

    const handleCursorUp = (event) => {
      sendCursorImmediately("up", event);
    };

    const handleCursorEnter = (event) => {
      queueCursorMove(event);
    };

    const handleCursorLeave = (event) => {
      cancelPendingCursorMove();
      sendCursorPointer("leave", event);
    };

    window.addEventListener("pointermove", handleCursorMove, true);
    window.addEventListener("pointerdown", handleCursorDown, true);
    window.addEventListener("pointerup", handleCursorUp, true);
    window.addEventListener("pointercancel", handleCursorUp, true);
    root.addEventListener("pointerenter", handleCursorEnter, true);
    root.addEventListener("pointerleave", handleCursorLeave, true);
    window.addEventListener("blur", handleCursorLeave);

    return () => {
      cancelPendingCursorMove();
      window.removeEventListener("pointermove", handleCursorMove, true);
      window.removeEventListener("pointerdown", handleCursorDown, true);
      window.removeEventListener("pointerup", handleCursorUp, true);
      window.removeEventListener("pointercancel", handleCursorUp, true);
      root.removeEventListener("pointerenter", handleCursorEnter, true);
      root.removeEventListener("pointerleave", handleCursorLeave, true);
      window.removeEventListener("blur", handleCursorLeave);
    };
  }, []);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const handlePointerDown = (event) => {
      if (event.button !== 0) return;

      if (event.pointerType === "touch" || event.pointerType === "pen") {
        event.preventDefault();
      }

      const pointerId = event.pointerId ?? 1;

      // R3F resolves mesh handlers during the same native event. Deferring
      // this check lets the card handler mark the pointer first.
      queueMicrotask(() => {
        if (
          interactionRef.current.cardPointerId === pointerId ||
          interactionRef.current.keywordPointerId !== null
        ) {
          return;
        }

        interactionRef.current.keywordPointerId = pointerId;
        wrapper.setPointerCapture?.(pointerId);
        sendKeywordPointer("down", event);
      });
    };

    const handlePointerMove = (event) => {
      const pointerId = event.pointerId ?? 1;
      if (interactionRef.current.keywordPointerId !== pointerId) return;

      if (event.pointerType === "touch" || event.pointerType === "pen") {
        event.preventDefault();
      }

      sendKeywordPointer("move", event);
    };

    const finishPointer = (event) => {
      const pointerId = event.pointerId ?? 1;

      if (interactionRef.current.keywordPointerId === pointerId) {
        if (event.pointerType === "touch" || event.pointerType === "pen") {
          event.preventDefault();
        }

        sendKeywordPointer("up", event);
        interactionRef.current.keywordPointerId = null;

        if (wrapper.hasPointerCapture?.(pointerId)) {
          wrapper.releasePointerCapture(pointerId);
        }
      }

      if (interactionRef.current.cardPointerId === pointerId) {
        interactionRef.current.cardPointerId = null;
      }
    };

    wrapper.addEventListener("pointerdown", handlePointerDown);
    wrapper.addEventListener("pointermove", handlePointerMove);
    wrapper.addEventListener("pointerup", finishPointer);
    wrapper.addEventListener("pointercancel", finishPointer);

    return () => {
      wrapper.removeEventListener("pointerdown", handlePointerDown);
      wrapper.removeEventListener("pointermove", handlePointerMove);
      wrapper.removeEventListener("pointerup", finishPointer);
      wrapper.removeEventListener("pointercancel", finishPointer);
    };
  }, []);

  const handleCardPointerDown = (pointerId) => {
    interactionRef.current.cardPointerId = pointerId;
  };

  const handleCardPointerUp = (pointerId) => {
    if (interactionRef.current.cardPointerId === pointerId) {
      interactionRef.current.cardPointerId = null;
    }
  };

  return (
    <div
      className="lanyard-wrapper"
      ref={wrapperRef}
      style={{
        touchAction: "none",
        cursor: "none",
        userSelect: "none",
        WebkitUserSelect: "none",
        WebkitTouchCallout: "none",
      }}
    >
      <Canvas
        style={{ touchAction: "none", cursor: "none" }}
        camera={{ position: position, fov: fov }}
        dpr={[1, isMobile ? 1.5 : 2]}
        gl={{ alpha: transparent }}
        onCreated={({ gl }) =>
          gl.setClearColor(new THREE.Color(0x000000), transparent ? 0 : 1)
        }
      >
        <ambientLight intensity={Math.PI} />
        <Physics gravity={gravity} timeStep={1 / 60}>
          <Band
            isMobile={isMobile}
            frontImage={frontImage}
            backImage={backImage}
            imageFit={imageFit}
            lanyardImage={lanyardImage}
            lanyardWidth={lanyardWidth}
            lanyardRepeat={lanyardRepeat}
            onCardPointerDown={handleCardPointerDown}
            onCardPointerUp={handleCardPointerUp}
          />
        </Physics>
        <Environment blur={0.75}>
          <Lightformer
            intensity={2}
            color="white"
            position={[0, -1, 5]}
            rotation={[0, 0, Math.PI / 3]}
            scale={[100, 0.1, 1]}
          />
          <Lightformer
            intensity={3}
            color="white"
            position={[-1, -1, 1]}
            rotation={[0, 0, Math.PI / 3]}
            scale={[100, 0.1, 1]}
          />
          <Lightformer
            intensity={3}
            color="white"
            position={[1, 1, 1]}
            rotation={[0, 0, Math.PI / 3]}
            scale={[100, 0.1, 1]}
          />
          <Lightformer
            intensity={10}
            color="white"
            position={[-10, 0, 14]}
            rotation={[0, Math.PI / 2, Math.PI / 3]}
            scale={[100, 10, 1]}
          />
        </Environment>
      </Canvas>
    </div>
  );
}
function Band({
  maxSpeed = 50,
  minSpeed = 0,
  isMobile = false,
  frontImage = null,
  backImage = null,
  imageFit = "cover",
  lanyardImage = null,
  lanyardWidth = 1,
  lanyardRepeat = 2,
  onCardPointerDown = () => {},
  onCardPointerUp = () => {},
}) {
  const band = useRef(),
    fixed = useRef(),
    j1 = useRef(),
    j2 = useRef(),
    j3 = useRef(),
    card = useRef();
  const vec = new THREE.Vector3(),
    ang = new THREE.Vector3(),
    rot = new THREE.Vector3();
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const dragPlane = useMemo(
    () => new THREE.Plane(new THREE.Vector3(0, 0, 1), 0),
    []
  );
  const pointerWorld = useMemo(() => new THREE.Vector3(), []);
  const dragTarget = useMemo(() => new THREE.Vector3(), []);
  const anchorPosition = useMemo(() => new THREE.Vector3(), []);
  const currentPosition = useMemo(() => new THREE.Vector3(), []);
  const movement = useMemo(() => new THREE.Vector3(), []);
  const segmentProps = {
    type: "dynamic",
    canSleep: true,
    colliders: false,
    ccd: true,
    additionalSolverIterations: 4,
    angularDamping: 4,
    linearDamping: 4,
  };
  const { nodes, materials } = useGLTF(cardGLB);
  const texture = useTexture(lanyardImage || lanyard);
  // useTexture must be called unconditionally; use a blank pixel when an image
  // isn't supplied for a given face, then skip compositing it below.
  const frontTex = useTexture(frontImage || BLANK_PIXEL);
  const backTex = useTexture(backImage || BLANK_PIXEL);

  // The card mesh is slightly wider than its UV rectangle. Using the mesh's
  // actual aspect ratio lets us pre-compensate the atlas drawing so portraits,
  // lettering, and circles keep their original proportions on the final card.
  const cardAspect = useMemo(() => {
    const geometry = nodes.card.geometry;
    geometry.computeBoundingBox();

    if (!geometry.boundingBox) return 0.7164;

    const size = new THREE.Vector3();
    geometry.boundingBox.getSize(size);
    return size.y ? size.x / size.y : 0.7164;
  }, [nodes.card.geometry]);

  // Composite the front/back images into the card's texture atlas (front = left
  // half, back = right half). Cropping/letterboxing is calculated against the
  // physical card, then pre-warped into the atlas so the mesh unwarps it again.
  const cardMap = useMemo(() => {
    const baseMap = materials.base.map;
    if (!frontImage && !backImage) return baseMap;

    const baseImg = baseMap.image;
    const W = baseImg.width;
    const H = baseImg.height;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return baseMap;
    // Keep the original baked atlas for the card edges and any untouched face.
    ctx.drawImage(baseImg, 0, 0, W, H);

    const drawMapped = (img, rect) => {
      const rx = rect.x * W;
      const ry = rect.y * H;
      const rw = rect.w * W;
      const rh = rect.h * H;
      const sourceAspect = img.width / img.height;

      ctx.save();
      ctx.beginPath();
      ctx.rect(rx, ry, rw, rh);
      ctx.clip();

      if (imageFit === "contain") {
        let dx = rx;
        let dy = ry;
        let dw = rw;
        let dh = rh;

        if (sourceAspect > cardAspect) {
          dh = rh * (cardAspect / sourceAspect);
          dy += (rh - dh) / 2;
        } else {
          dw = rw * (sourceAspect / cardAspect);
          dx += (rw - dw) / 2;
        }

        ctx.drawImage(img, dx, dy, dw, dh);
      } else {
        let sx = 0;
        let sy = 0;
        let sw = img.width;
        let sh = img.height;

        if (sourceAspect > cardAspect) {
          sw = sh * cardAspect;
          sx = (img.width - sw) / 2;
        } else {
          sh = sw / cardAspect;
          sy = (img.height - sh) / 2;
        }

        ctx.drawImage(img, sx, sy, sw, sh, rx, ry, rw, rh);
      }

      ctx.restore();
    };

    if (frontImage && frontTex.image) drawMapped(frontTex.image, FRONT_UV_RECT);
    if (backImage && backTex.image) drawMapped(backTex.image, BACK_UV_RECT);

    const composite = new THREE.CanvasTexture(canvas);
    composite.colorSpace = THREE.SRGBColorSpace;
    composite.flipY = baseMap.flipY;
    composite.anisotropy = 16;
    composite.needsUpdate = true;
    return composite;
  }, [
    frontImage,
    backImage,
    imageFit,
    frontTex,
    backTex,
    materials.base.map,
    cardAspect,
  ]);
  const [curve] = useState(
    () =>
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(),
        new THREE.Vector3(),
        new THREE.Vector3(),
        new THREE.Vector3(),
      ])
  );
  const [dragged, drag] = useState(false);

  useRopeJoint(fixed, j1, [[0, 0, 0], [0, 0, 0], 1]);
  useRopeJoint(j1, j2, [[0, 0, 0], [0, 0, 0], 1]);
  useRopeJoint(j2, j3, [[0, 0, 0], [0, 0, 0], 1]);
  useSphericalJoint(j3, card, [
    [0, 0, 0],
    [0, 1.5, 0],
  ]);

  useFrame((state, delta) => {
    if (dragged && card.current && fixed.current) {
      // Intersect the pointer with the same Z plane as the rope instead of
      // extrapolating from the camera. This prevents large coordinate jumps
      // near the viewport edges.
      raycaster.setFromCamera(state.pointer, state.camera);

      if (raycaster.ray.intersectPlane(dragPlane, pointerWorld)) {
        anchorPosition.copy(fixed.current.translation());
        dragTarget.copy(pointerWorld).sub(dragged);
        dragTarget.z = anchorPosition.z;

        // Move in bounded steps rather than teleporting the card every frame.
        // This keeps fast mouse/touch gestures stable at both 30 and 60 fps.
        currentPosition.copy(card.current.translation());
        movement.copy(dragTarget).sub(currentPosition);
        const maxStep = Math.min(
          MAX_DRAG_STEP,
          Math.max(0.08, delta * 10)
        );

        if (movement.length() > maxStep) {
          movement.setLength(maxStep);
        }

        currentPosition.add(movement);
        card.current.setNextKinematicTranslation(currentPosition);
      }

      [card, j1, j2, j3, fixed].forEach((ref) => ref.current?.wakeUp());
    }
    if (fixed.current) {
      [j1, j2].forEach((ref) => {
        if (!ref.current.lerped)
          ref.current.lerped = new THREE.Vector3().copy(
            ref.current.translation()
          );
        const clampedDistance = Math.max(
          0.1,
          Math.min(1, ref.current.lerped.distanceTo(ref.current.translation()))
        );
        ref.current.lerped.lerp(
          ref.current.translation(),
          delta * (minSpeed + clampedDistance * (maxSpeed - minSpeed))
        );
      });
      curve.points[0].copy(j3.current.translation());
      curve.points[1].copy(j2.current.lerped);
      curve.points[2].copy(j1.current.lerped);
      curve.points[3].copy(fixed.current.translation());
      band.current.geometry.setPoints(curve.getPoints(isMobile ? 16 : 32));
      ang.copy(card.current.angvel());
      rot.copy(card.current.rotation());
      card.current.setAngvel({ x: ang.x, y: ang.y - rot.y * 0.25, z: ang.z });
    }
  });

  curve.curveType = "chordal";
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  // Keep MeshLine's repeat count on a stable whole-number tile boundary.
  // App code that still passes 1.5 is normalized to 2 automatically.
  const stableLanyardRepeat = Math.max(
    1,
    Math.round(Number(lanyardRepeat) || 2)
  );

  return (
    <>
      <group position={[0, 4, 0]}>
        <RigidBody ref={fixed} {...segmentProps} type="fixed" />
        <RigidBody position={[0.5, 0, 0]} ref={j1} {...segmentProps}>
          <BallCollider args={[0.1]} />
        </RigidBody>
        <RigidBody position={[1, 0, 0]} ref={j2} {...segmentProps}>
          <BallCollider args={[0.1]} />
        </RigidBody>
        <RigidBody position={[1.5, 0, 0]} ref={j3} {...segmentProps}>
          <BallCollider args={[0.1]} />
        </RigidBody>
        <RigidBody
          position={[2, 0, 0]}
          ref={card}
          {...segmentProps}
          type={dragged ? "kinematicPosition" : "dynamic"}
        >
          <CuboidCollider args={[0.8, 1.125, 0.01]} />
          <group
            scale={2.25}
            position={[0, -1.2, -0.05]}
            onPointerUp={(e) => {
              e.stopPropagation();
              e.nativeEvent?.preventDefault?.();
              onCardPointerUp(e.pointerId);
              card.current?.setLinvel({ x: 0, y: 0, z: 0 }, true);
              card.current?.setAngvel({ x: 0, y: 0, z: 0 }, true);
              if (e.target.hasPointerCapture?.(e.pointerId)) {
                e.target.releasePointerCapture(e.pointerId);
              }
              drag(false);
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              e.nativeEvent?.preventDefault?.();
              onCardPointerDown(e.pointerId);
              e.target.setPointerCapture(e.pointerId);
              drag(
                new THREE.Vector3()
                  .copy(e.point)
                  .sub(vec.copy(card.current.translation()))
              );
            }}
            onPointerCancel={(e) => {
              e.stopPropagation();
              e.nativeEvent?.preventDefault?.();
              onCardPointerUp(e.pointerId);
              card.current?.setLinvel({ x: 0, y: 0, z: 0 }, true);
              card.current?.setAngvel({ x: 0, y: 0, z: 0 }, true);
              drag(false);
            }}
          >
            <mesh geometry={nodes.card.geometry}>
              <meshPhysicalMaterial
                map={cardMap}
                map-anisotropy={16}
                clearcoat={isMobile ? 0 : 1}
                clearcoatRoughness={0.15}
                roughness={0.9}
                metalness={0.8}
              />
            </mesh>
            <mesh
              geometry={nodes.clip.geometry}
              material={materials.metal}
              material-roughness={0.3}
            />
            <mesh geometry={nodes.clamp.geometry} material={materials.metal} />
          </group>
        </RigidBody>
      </group>
      <mesh ref={band}>
        <meshLineGeometry />
        <meshLineMaterial
          color="white"
          depthTest={false}
          resolution={isMobile ? [1000, 2000] : [1000, 1000]}
          useMap
          map={texture}
          repeat={[-stableLanyardRepeat, 1]}
          lineWidth={lanyardWidth}
        />
      </mesh>
    </>
  );
}
