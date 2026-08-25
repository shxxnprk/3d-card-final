import { useEffect } from "react";
import "./styles.css";
import Lanyard from "./Lanyard";

function ImwebCursorBridge() {
  useEffect(() => {
    /*
     * iframe이 아닌 일반 페이지로 열렸을 때는
     * 브리지를 실행하지 않습니다.
     */
    if (window.parent === window) {
      return;
    }

    /*
     * 현재 iframe을 불러온 부모 페이지의 주소를 구합니다.
     * 주소를 구할 수 없는 경우에만 "*"를 사용합니다.
     */
    let parentOrigin = "*";

    try {
      if (document.referrer) {
        parentOrigin = new URL(
          document.referrer
        ).origin;
      }
    } catch (error) {
      parentOrigin = "*";
    }

    function sendPointer(type, event) {
      window.parent.postMessage(
        {
          channel: "IMWEB_CURSOR_BRIDGE",
          type: type,

          x: event?.clientX ?? 0,
          y: event?.clientY ?? 0,

          button: event?.button ?? 0,
          buttons: event?.buttons ?? 0
        },
        parentOrigin
      );
    }

    function handleMove(event) {
      sendPointer("move", event);
    }

    function handleDown(event) {
      sendPointer("down", event);
    }

    function handleUp(event) {
      sendPointer("up", event);
    }

    function handlePointerOut(event) {
      /*
       * iframe 문서 밖으로 완전히 나갈 때만
       * 커서를 숨기도록 전달합니다.
       */
      if (event.relatedTarget === null) {
        sendPointer("leave", event);
      }
    }

    function handleBlur(event) {
      sendPointer("leave", event);
    }

    window.addEventListener(
      "pointermove",
      handleMove,
      { passive: true }
    );

    window.addEventListener(
      "pointerdown",
      handleDown,
      { passive: true }
    );

    window.addEventListener(
      "pointerup",
      handleUp,
      { passive: true }
    );

    window.addEventListener(
      "pointerout",
      handlePointerOut,
      { passive: true }
    );

    window.addEventListener(
      "blur",
      handleBlur
    );

    return () => {
      window.removeEventListener(
        "pointermove",
        handleMove
      );

      window.removeEventListener(
        "pointerdown",
        handleDown
      );

      window.removeEventListener(
        "pointerup",
        handleUp
      );

      window.removeEventListener(
        "pointerout",
        handlePointerOut
      );

      window.removeEventListener(
        "blur",
        handleBlur
      );
    };
  }, []);

  return null;
}

export default function App() {
  return (
    <div className="App">
      <ImwebCursorBridge />

      <Lanyard
        position={[0, 0, 20]}
        gravity={[0, -40, 0]}
        frontImage="https://cdn.imweb.me/upload/S2026072479051d98f7a2d/e99a6579ef617.png"
        backImage="https://cdn.imweb.me/upload/S2026072479051d98f7a2d/e02e35112a929.png"
        lanyardImage="https://cdn.imweb.me/upload/S2026072479051d98f7a2d/2d0e4c011a3bc.png"
        lanyardWidth={1.2}
        imageFit="cover"
      />
    </div>
  );
}
