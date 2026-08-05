import "./styles.css";
import Lanyard from "./Lanyard";

export default function App() {
  return (
    <div className="App">
      <Lanyard
        position={[0, 0, 20]}
        gravity={[0, -40, 0]}
        frontImage="https://cdn.imweb.me/upload/S2026072479051d98f7a2d/3c2b3ff729309.png"
        backImage="https://cdn.imweb.me/upload/S2026072479051d98f7a2d/3c2b3ff729309.png"
        lanyardImage="https://cdn.imweb.me/upload/S2026072479051d98f7a2d/3c2b3ff729309.png" // 💡 아임웹 주소를 직접 넣었습니다!
        lanyardWidth={1.2}
        imageFit="cover"
      />
    </div>
  );
}
