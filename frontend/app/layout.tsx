import type { Metadata } from "next";
import "./globals.css";
import Sidebar from "@/components/Sidebar";

export const metadata: Metadata = {
  title: "InnovateBHARAT AI Engine",
  description: "AI-Powered Architectural Co-Pilot for Complex Codebases",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-[#020617] text-slate-200 h-screen overflow-hidden">
        <Sidebar>{children}</Sidebar>
      </body>
    </html>
  );
}