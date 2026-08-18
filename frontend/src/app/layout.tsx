import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Enterprise RAG Document Engine | Vector Search & LLM Synthesis",
  description: "Production-ready Document Search & Synthesis Application powered by FastAPI, FastEmbed, Groq, and PgVector HNSW.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark h-full">
      <body className="h-full bg-background text-slate-100 flex flex-col overflow-hidden">
        {children}
      </body>
    </html>
  );
}
