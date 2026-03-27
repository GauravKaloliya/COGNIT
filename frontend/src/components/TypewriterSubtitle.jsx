import React from "react";

const WRONG_CHAR_MAP = {
  a: "s",
  c: "x",
  d: "s",
  e: "w",
  g: "f",
  h: "g",
  i: "u",
  l: "k",
  m: "n",
  o: "i",
  p: "o",
  r: "e",
  s: "a",
  t: "r",
  u: "y",
};

const WORD_LEVEL_MISTAKES = [
  { target: "Describe", wrong: "Descirbe" },
  { target: "detail", wrong: "detial" },
  { target: "possible", wrong: "posible" },
];

export default function TypewriterSubtitle({
  text,
  className = "subtitle",
  typingSpeedMs = 46,
  startDelayMs = 240,
}) {
  const [displayedText, setDisplayedText] = React.useState("");
  const [isActiveTyping, setIsActiveTyping] = React.useState(false);
  const [phase, setPhase] = React.useState("typing");
  const prefersReducedMotion = React.useMemo(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  React.useEffect(() => {
    const fullText = String(text || "");
    if (!fullText) {
      setDisplayedText("");
      setIsActiveTyping(false);
      setPhase("idle");
      return undefined;
    }
    if (prefersReducedMotion) {
      setDisplayedText(fullText);
      setIsActiveTyping(false);
      setPhase("idle");
      return undefined;
    }

    setDisplayedText("");
    setIsActiveTyping(true);
    setPhase("typing");
    let timeoutId = null;
    let active = true;

    const typoPoints = Array.from(new Set([
      Math.max(6, Math.floor(fullText.length * 0.28)),
      Math.max(14, Math.floor(fullText.length * 0.67)),
    ])).filter((point) => point < fullText.length - 2);

    const sleep = (ms) => new Promise((resolve) => {
      timeoutId = window.setTimeout(resolve, ms);
    });

    const variableDelay = (base, spread) => base + Math.floor(Math.random() * spread);

    const getWrongChar = (char) => {
      const lower = char.toLowerCase();
      const wrong = WRONG_CHAR_MAP[lower] || "x";
      return char === lower ? wrong : wrong.toUpperCase();
    };

    const buildWordMistakes = () => {
      const matches = [];
      WORD_LEVEL_MISTAKES.forEach(({ target, wrong }) => {
        const start = fullText.indexOf(target);
        if (start >= 0) {
          matches.push({
            start,
            end: start + target.length,
            wrong,
            correct: target,
          });
        }
      });
      return matches.slice(0, 2);
    };

    const getTypingDelay = (char, previousChar, nextChar, index) => {
      const isSpace = char === " ";
      const isPunctuation = /[,.!?]/.test(char);
      const startsWord = index === 0 || previousChar === " ";
      const nextIsSpaceOrEnd = !nextChar || nextChar === " " || /[,.!?]/.test(nextChar);

      if (isPunctuation) {
        return variableDelay(220, 140);
      }

      if (isSpace) {
        return variableDelay(95, 55);
      }

      if (startsWord) {
        return variableDelay(72, 65);
      }

      if (nextIsSpaceOrEnd) {
        return variableDelay(68, 60);
      }

      return variableDelay(typingSpeedMs, 68);
    };

    const runLoop = async () => {
      await sleep(startDelayMs);
      while (active) {
        let currentText = "";
        let typoIndex = 0;
        const wordMistakes = buildWordMistakes();
        let wordMistakeIndex = 0;
        setPhase("resetting");
        await sleep(variableDelay(180, 90));
        if (!active) break;
        setPhase("typing");

        for (let index = 0; index < fullText.length && active; index += 1) {
          const nextChar = fullText[index];
          const previousChar = fullText[index - 1] || "";
          const upcomingChar = fullText[index + 1] || "";
          const currentWordMistake = wordMistakes[wordMistakeIndex];
          const shouldMistypeWord = currentWordMistake && index === currentWordMistake.start;
          const shouldMistype = typoIndex < typoPoints.length && index === typoPoints[typoIndex];

          if (shouldMistypeWord) {
            setIsActiveTyping(true);
            setPhase("typing");

            for (const wrongChar of currentWordMistake.wrong) {
              currentText += wrongChar;
              setDisplayedText(currentText);
              await sleep(variableDelay(typingSpeedMs + 18, 64));
              if (!active) break;
            }
            if (!active) break;

            setIsActiveTyping(false);
            setPhase("correcting");
            await sleep(variableDelay(340, 160));
            if (!active) break;

            setIsActiveTyping(true);
            setPhase("correcting");
            while (currentText.length > 0 && !currentText.endsWith(" ")) {
              currentText = currentText.slice(0, -1);
              setDisplayedText(currentText);
              await sleep(variableDelay(42, 36));
              if (!active) break;
            }
            if (!active) break;

            setPhase("typing");
            for (const correctChar of currentWordMistake.correct) {
              currentText += correctChar;
              setDisplayedText(currentText);
              await sleep(variableDelay(typingSpeedMs + 10, 54));
              if (!active) break;
            }
            if (!active) break;

            index = currentWordMistake.end - 1;
            wordMistakeIndex += 1;
            continue;
          }

          if (shouldMistype) {
            setIsActiveTyping(true);
            setPhase("typing");
            currentText += getWrongChar(nextChar);
            setDisplayedText(currentText);
            await sleep(variableDelay(typingSpeedMs + 120, 110));
            if (!active) break;

            setIsActiveTyping(false);
            setPhase("correcting");
            await sleep(variableDelay(320, 140));
            if (!active) break;

            setIsActiveTyping(true);
            setPhase("correcting");
            currentText = currentText.slice(0, -1);
            setDisplayedText(currentText);
            await sleep(variableDelay(260, 130));
            if (!active) break;

            typoIndex += 1;
          }

          setIsActiveTyping(true);
          setPhase("typing");
          currentText += nextChar;
          setDisplayedText(currentText);
          await sleep(getTypingDelay(nextChar, previousChar, upcomingChar, index));
        }

        if (!active) break;

        setIsActiveTyping(false);
        setPhase("holding");
        await sleep(variableDelay(2600, 550));
        setPhase("clearing");
        while (currentText.length > 0 && active) {
          currentText = currentText.slice(0, -1);
          setDisplayedText(currentText || "");
          await sleep(variableDelay(26, 22));
        }
        if (!active) break;
        setPhase("resetting");
        await sleep(variableDelay(520, 220));
      }
    };

    runLoop();

    return () => {
      active = false;
      setIsActiveTyping(false);
      setPhase("idle");
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
  }, [prefersReducedMotion, startDelayMs, text, typingSpeedMs]);

  return (
    <p className={`${className} subtitle-typewriter subtitle-cinematic`} aria-label={text}>
      <span className={`subtitle-live-track is-${phase}`} aria-hidden="true">
        <span className="subtitle-live-text">{displayedText || "\u00A0"}</span>
        <span
          className={`subtitle-caret${isActiveTyping ? " is-typing" : " is-hidden"}`}
        />
      </span>
    </p>
  );
}
