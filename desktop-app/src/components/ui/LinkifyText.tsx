import React from "react";

const URL_REGEX = /(https?:\/\/[^\s),]+)/g;
const URL_TEST = /^https?:\/\//;

export function LinkifyText({ text }: { text: string }) {
  const parts = text.split(URL_REGEX);
  return (
    <>
      {parts.map((part, i) =>
        URL_TEST.test(part) ? (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer" style={{ color: "#4ec9b0" }}>
            {part}
          </a>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        )
      )}
    </>
  );
}
