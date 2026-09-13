import type { Metadata } from "next";
import { ButlerChat } from "@/components/butler-chat";
export const metadata: Metadata = { title: "管家" };
export default function ButlerPage() {
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">YOUR SPACE TO GROW</p>
          <h1>有想法，就和管家聊聊</h1>
          <p>一起整理方向，也允许自己改变方向。</p>
        </div>
      </div>
      <ButlerChat />
    </>
  );
}
