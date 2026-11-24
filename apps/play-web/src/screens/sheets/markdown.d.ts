// A Markdown file imported by a module is its text (vite.config.ts, frx-markdown-text).
declare module '*.md' {
  const text: string;
  export default text;
}
