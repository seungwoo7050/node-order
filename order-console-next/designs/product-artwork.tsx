"use client";

import styles from "./product-artwork.module.css";
import type { StoreDesignId } from "./types";

const TONE_CLASSES = [
  styles.atelierTone0,
  styles.atelierTone1,
  styles.atelierTone2,
  styles.atelierTone3,
];

export function StudioProductArtwork({
  id,
  design,
}: {
  id: number;
  name?: string;
  category?: string;
  design: StoreDesignId;
}) {
  const variantIdx = Math.abs(id) % 4;
  const code = String(id).padStart(3, "0");

  if (design === "editorial-atelier") {
    const toneClass = TONE_CLASSES[variantIdx] ?? styles.atelierTone0;
    return (
      <div
        aria-hidden="true"
        className={`${styles.atelierPlate} ${toneClass}`}
      >
        <div className={styles.atelierTopMeta}>
          <span>LOOK // {code}</span>
          <span>ARCHIVE 26</span>
        </div>

        <svg
          viewBox="0 0 240 300"
          className={styles.plateSvg}
          fill="none"
        >
          <polygon
            points="0,0 240,40 240,300 40,300"
            fill="#f7f5f0"
            fillOpacity="0.45"
          />
          <rect
            x="24"
            y="38"
            width="192"
            height="224"
            stroke="#1c1b19"
            strokeOpacity="0.14"
            strokeWidth="0.75"
          />
          <line
            x1="24"
            y1="218"
            x2="216"
            y2="218"
            stroke="#1c1b19"
            strokeOpacity="0.12"
            strokeWidth="0.75"
          />

          {variantIdx === 0 && (
            <g>
              <path
                d="M86 68 L120 58 L154 68 L184 96 L168 148 L154 140 L154 228 L86 228 L86 140 L72 148 L56 96 Z"
                fill="#1c1b19"
                fillOpacity="0.86"
              />
              <path
                d="M106 60 L120 112 L134 60"
                stroke="#f7f5f0"
                strokeWidth="1.2"
                strokeOpacity="0.7"
              />
              <line
                x1="120"
                y1="112"
                x2="120"
                y2="228"
                stroke="#f7f5f0"
                strokeWidth="0.9"
                strokeOpacity="0.45"
              />
            </g>
          )}

          {variantIdx === 1 && (
            <g>
              <path
                d="M78 76 C96 66, 144 66, 162 76 L186 122 L162 134 L152 104 L152 222 L88 222 L88 104 L78 134 L54 122 Z"
                fill="#73695d"
                fillOpacity="0.32"
                stroke="#292724"
                strokeWidth="1.2"
              />
              <circle
                cx="120"
                cy="148"
                r="42"
                stroke="#292724"
                strokeOpacity="0.22"
                strokeWidth="0.8"
              />
              <path
                d="M88 168 L152 168"
                stroke="#292724"
                strokeOpacity="0.35"
                strokeWidth="0.8"
              />
            </g>
          )}

          {variantIdx === 2 && (
            <g>
              <rect
                x="72"
                y="88"
                width="96"
                height="116"
                fill="#181817"
                fillOpacity="0.82"
              />
              <path
                d="M96 88 C96 62, 144 62, 144 88"
                stroke="#181817"
                strokeWidth="2"
              />
              <rect
                x="84"
                y="102"
                width="72"
                height="88"
                stroke="#f6f4ef"
                strokeOpacity="0.4"
                strokeWidth="0.8"
              />
            </g>
          )}

          {variantIdx === 3 && (
            <g>
              <path
                d="M84 68 L156 68 L168 228 L126 228 L120 128 L114 228 L72 228 Z"
                fill="#22201d"
                fillOpacity="0.8"
              />
              <line
                x1="102"
                y1="68"
                x2="96"
                y2="228"
                stroke="#f0ece3"
                strokeOpacity="0.35"
                strokeWidth="0.8"
              />
              <line
                x1="138"
                y1="68"
                x2="144"
                y2="228"
                stroke="#f0ece3"
                strokeOpacity="0.35"
                strokeWidth="0.8"
              />
            </g>
          )}
        </svg>

        <div className={styles.atelierBottomMeta}>
          <span className={styles.atelierStudyLabel}>
            Atelier Study No. {code}
          </span>
          <span className={styles.atelierRatioLabel}>3:4 PLATE</span>
        </div>
      </div>
    );
  }

  if (design === "muji-hara") {
    return (
      <div aria-hidden="true" className={styles.mujiPlate}>
        <div className={styles.mujiTopMeta}>
          <span className={styles.mujiCrimsonText}>標本 · {code}</span>
          <span>MUJI ARCHIVE</span>
        </div>

        <svg
          viewBox="0 0 240 240"
          className={styles.plateSvg}
          fill="none"
        >
          <circle
            cx="120"
            cy="120"
            r="68"
            fill="#f7f3eb"
            stroke="#c8bca6"
            strokeWidth="1"
          />
          <circle
            cx="120"
            cy="120"
            r="54"
            stroke="#d6ccb9"
            strokeWidth="0.75"
            strokeDasharray="3 3"
          />
          {variantIdx % 2 === 0 ? (
            <g>
              <rect
                x="86"
                y="82"
                width="68"
                height="76"
                rx="4"
                stroke="#26231f"
                strokeWidth="1.4"
                fill="#ebe3d3"
              />
              <line
                x1="86"
                y1="104"
                x2="154"
                y2="104"
                stroke="#7f1d1d"
                strokeWidth="1.2"
              />
              <line
                x1="102"
                y1="122"
                x2="138"
                y2="122"
                stroke="#26231f"
                strokeWidth="0.9"
                strokeOpacity="0.5"
              />
              <line
                x1="102"
                y1="134"
                x2="128"
                y2="134"
                stroke="#26231f"
                strokeWidth="0.9"
                strokeOpacity="0.5"
              />
            </g>
          ) : (
            <g>
              <path
                d="M84 96 L120 78 L156 96 L146 160 L94 160 Z"
                fill="#e5dcc8"
                stroke="#26231f"
                strokeWidth="1.3"
              />
              <circle
                cx="120"
                cy="120"
                r="18"
                stroke="#7f1d1d"
                strokeWidth="1.1"
              />
            </g>
          )}
        </svg>

        <div className={styles.mujiBottomMeta}>
          <span className={styles.mujiSerieLabel}>
            Object Specimen No. {code}
          </span>
          <span className={styles.mujiSpecLabel}>1:1 SPECIMEN</span>
        </div>
      </div>
    );
  }

  return (
    <div aria-hidden="true" className={styles.zavanasPlate}>
      <div className={styles.zavanasTopMeta}>
        <span className={styles.zavanasCadBadge}>CAD // {code}</span>
        <span className={styles.zavanasLiveBadge}>● LIVE SPEC</span>
      </div>

      <svg
        viewBox="0 0 240 240"
        className={styles.plateSvg}
        fill="none"
      >
        <line x1="0" y1="60" x2="240" y2="60" stroke="#d0d7de" strokeWidth="0.6" />
        <line x1="0" y1="120" x2="240" y2="120" stroke="#d0d7de" strokeWidth="0.6" />
        <line x1="0" y1="180" x2="240" y2="180" stroke="#d0d7de" strokeWidth="0.6" />
        <line x1="60" y1="0" x2="60" y2="240" stroke="#d0d7de" strokeWidth="0.6" />
        <line x1="120" y1="0" x2="120" y2="240" stroke="#d0d7de" strokeWidth="0.6" />
        <line x1="180" y1="0" x2="180" y2="240" stroke="#d0d7de" strokeWidth="0.6" />

        <rect
          x="44"
          y="48"
          width="152"
          height="144"
          stroke="#111315"
          strokeWidth="1.2"
          fill="#ffffff"
          fillOpacity="0.75"
        />
        <rect
          x="68"
          y="72"
          width="104"
          height="96"
          stroke="#111315"
          strokeWidth="1.5"
        />
        <circle
          cx="104"
          cy="120"
          r="24"
          stroke="#111315"
          strokeWidth="1.4"
        />
        <circle cx="104" cy="120" r="5" fill="#ff4d00" />
        <line x1="142" y1="92" x2="158" y2="92" stroke="#111315" strokeWidth="1.5" />
        <line x1="142" y1="106" x2="158" y2="106" stroke="#111315" strokeWidth="1.5" />
        <line x1="142" y1="120" x2="158" y2="120" stroke="#ff4d00" strokeWidth="1.5" />
        <line x1="142" y1="134" x2="158" y2="134" stroke="#111315" strokeWidth="1.5" />
        <line x1="142" y1="148" x2="158" y2="148" stroke="#111315" strokeWidth="1.5" />
      </svg>

      <div className={styles.zavanasBottomMeta}>
        <span>SCALE 1:10</span>
        <span>REV.36 // {code}</span>
      </div>
    </div>
  );
}
