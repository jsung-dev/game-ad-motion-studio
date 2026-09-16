import Link from "next/link";
import {
  CheckCircle2,
  ChevronRight,
  Film,
  Layers3,
  Sparkles,
  UploadCloud,
} from "lucide-react";
import styles from "./HomeLanding.module.css";

const workflow = [
  {
    icon: UploadCloud,
    title: "\uC601\uC0C1 \uC785\uB825",
    description: "MP4\uB97C \uC62C\uB9AC\uAC70\uB098 \uC791\uC5C5\uD560 \uCEF7\uC744 \uCD94\uAC00\uD569\uB2C8\uB2E4.",
  },
  {
    icon: Sparkles,
    title: "\uCEF7 \uC0DD\uC131",
    description: "\uD504\uB86C\uD504\uD2B8\uC640 \uB808\uD37C\uB7F0\uC2A4\uB85C \uAC1C\uBCC4 \uCEF7\uC744 \uB9CC\uB4ED\uB2C8\uB2E4.",
  },
  {
    icon: Layers3,
    title: "\uCE74\uD53C \uD3B8\uC9D1",
    description: "\uD14D\uC2A4\uD2B8\uC640 PNG \uC624\uBC84\uB808\uC774\uB97C \uD0C0\uC784\uB77C\uC778\uC5D0 \uBC30\uCE58\uD569\uB2C8\uB2E4.",
  },
  {
    icon: Film,
    title: "MP4 \uCD9C\uB825",
    description: "\uC5F0\uACB0\uB41C \uCEF7\uACFC \uCE74\uD53C\uB97C \uD558\uB098\uC758 \uAD11\uACE0 \uC601\uC0C1\uC73C\uB85C \uB9CC\uB4ED\uB2C8\uB2E4.",
  },
] as const;

export function HomeLanding() {
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <Link className={styles.brand} href="/" aria-label="AD MOTION LAB \uD648">
            <span className={styles.brandMark}>
              <Film size={16} aria-hidden="true" />
            </span>
            <span>AD MOTION LAB</span>
          </Link>
          <Link className={styles.headerAction} href="/video-ad">
            {"\uC2A4\uD29C\uB514\uC624 \uC5F4\uAE30"}
            <ChevronRight size={15} aria-hidden="true" />
          </Link>
        </header>

        <section className={styles.hero}>
          <div className={styles.copy}>
            <p className={styles.eyebrow}>
              <span className={styles.eyebrowDot} aria-hidden="true" />
              AI GAME AD STUDIO
            </p>
            <h1>
              {"\uAC8C\uC784 \uAD11\uACE0\uB97C"}
              <br />
              <em>{"\uCEF7 \uB2E8\uC704\uB85C"}</em> {"\uC644\uC131\uD558\uC138\uC694."}
            </h1>
            <p className={styles.description}>
              {"\uC601\uC0C1, \uB808\uD37C\uB7F0\uC2A4, \uCE74\uD53C\uB97C \uD558\uB098\uC758 \uD0C0\uC784\uB77C\uC778\uC5D0\uC11C \uC5F0\uACB0\uD558\uACE0, \uBC14\uB85C \uAD11\uACE0 \uC601\uC0C1\uC73C\uB85C \uB9CC\uB4DC\uC138\uC694."}
            </p>
            <div className={styles.ctaRow}>
              <Link className={styles.primaryCta} href="/video-ad">
                {"\uC2A4\uD29C\uB514\uC624 \uC2DC\uC791\uD558\uAE30"}
                <ChevronRight size={18} aria-hidden="true" />
              </Link>
              <a className={styles.secondaryCta} href="#workflow">
                {"\uC791\uC5C5 \uBC29\uC2DD \uBCF4\uAE30"}
              </a>
            </div>
            <p className={styles.note}>
              <CheckCircle2 size={14} aria-hidden="true" />
              {"\uB85C\uADF8\uC778 \uC5C6\uC774 \uBC14\uB85C \uC791\uC5C5\uC744 \uC2DC\uC791\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4."}
            </p>
          </div>

          <div className={styles.studioPreview} aria-label="\uC601\uC0C1 \uC81C\uC791 \uC2A4\uD29C\uB514\uC624 \uBBF8\uB9AC\uBCF4\uAE30">
            <div className={styles.previewBar}>
              <div className={styles.previewDots} aria-hidden="true"><span /><span /><span /></div>
              <span>GAME AD STUDIO</span>
            </div>
            <div className={styles.previewBody}>
              <aside className={styles.toolRail}>
                <strong>{"\uC5D0\uC14B"}</strong>
                <span><UploadCloud size={12} aria-hidden="true" /> MP4</span>
                <span><Sparkles size={12} aria-hidden="true" /> AI Cut</span>
                <span><Layers3 size={12} aria-hidden="true" /> Copy</span>
              </aside>
              <div className={styles.previewCanvas}>
                <div className={styles.portrait} aria-hidden="true">
                  <span className={styles.previewCopy}>100{"\uC5F0 \uBF51\uAE30"}<br />{"\uBB34\uB8CC!"}</span>
                  <span className={styles.previewBadge}>9:16</span>
                </div>
                <div className={styles.timeline} aria-hidden="true">
                  <div className={styles.timelineHeader}><span>00:00</span><span>00:12</span></div>
                  <div className={styles.track}><span className={styles.videoTrack} /></div>
                  <div className={styles.track}><span className={styles.copyTrack} /></div>
                  <div className={styles.track}><span className={styles.effectTrack} /></div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className={styles.workflow} id="workflow">
          <div className={styles.sectionHeading}>
            <p>ONE WORKFLOW</p>
            <h2>{"\uD544\uC694\uD55C \uC81C\uC791 \uACFC\uC815\uB9CC \uAC04\uACB0\uD558\uAC8C."}</h2>
          </div>
          <div className={styles.steps}>
            {workflow.map((step, index) => {
              const Icon = step.icon;
              return (
                <article className={styles.step} key={step.title}>
                  <span className={styles.stepIcon}><Icon size={17} aria-hidden="true" /></span>
                  <span className={styles.stepNumber}>0{index + 1}</span>
                  <h3>{step.title}</h3>
                  <p>{step.description}</p>
                </article>
              );
            })}
          </div>
        </section>

        <footer className={styles.footer}>
          <span>AD MOTION LAB</span>
          <Link href="/video-ad">{"\uC2A4\uD29C\uB514\uC624\uB85C \uC774\uB3D9"} <ChevronRight size={13} aria-hidden="true" /></Link>
        </footer>
      </div>
    </main>
  );
}
