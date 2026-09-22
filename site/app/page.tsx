import fs from "node:fs";
import path from "node:path";
import Script from "next/script";

function readTerminalSource(fileName: string) {
  return fs.readFileSync(path.join(process.cwd(), "dist", fileName), "utf8");
}

function extractBodyMarkup(documentSource: string) {
  const bodyMatch = documentSource.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (!bodyMatch) {
    throw new Error("Terminal source is missing a body element.");
  }

  return bodyMatch[1].replace(
    /\s*<script[^>]+src=["']\.\/app\.js["'][^>]*><\/script>/i,
    "",
  );
}

const terminalMarkup = extractBodyMarkup(readTerminalSource("index.html"));
const terminalRuntime = readTerminalSource("app.js");

export default function HomePage() {
  return (
    <>
      <div dangerouslySetInnerHTML={{ __html: terminalMarkup }} />
      <Script id="terminal-runtime" strategy="afterInteractive">
        {terminalRuntime}
      </Script>
    </>
  );
}
