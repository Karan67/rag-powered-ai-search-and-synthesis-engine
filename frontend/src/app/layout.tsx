import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RAG Engine — Chat with your documents",
  description:
    "Upload documents and ask questions. Answers are synthesised from your own files with inline, verifiable citations.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#171717" },
  ],
};

// Applied before first paint so the correct theme is on <html> when React
// hydrates — without this the page flashes light before the toggle runs.
const THEME_INIT = `
try {
  var t = localStorage.getItem('theme');
  if (!t) t = 'dark';
  if (t === 'dark') document.documentElement.classList.add('dark');
} catch (e) {
  document.documentElement.classList.add('dark');
}
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className="h-full overflow-hidden">{children}</body>
    </html>
  );
}
