"use client";

import type { CSSProperties } from "react";
import { useMemo, useState } from "react";
import { ArrowUpRight, BrainCircuit, Gamepad2, Heart, Menu, Scale, Sparkles, Timer, Trophy, Users, X } from "lucide-react";
import { categories, getCategory, playContents } from "@/data/play-content";
import type { CategoryIcon, PlayContent } from "@/types/play-content";
import styles from "./HomeLanding.module.css";

const categoryIcons = { mind: BrainCircuit, heart: Heart, balance: Scale, quiz: Trophy, game: Gamepad2 } satisfies Record<CategoryIcon, typeof BrainCircuit>;

function formatParticipants(value: number) {
  return value >= 10_000 ? `${(value / 10_000).toFixed(1)}만` : value.toLocaleString("ko-KR");
}

function Artwork({ content, compact = false }: { content: PlayContent; compact?: boolean }) {
  const artworkStyle = { "--art-gradient": content.thumbnail_gradient, "--art-accent": content.thumbnail_accent } as CSSProperties;
  return (
    <div className={`${styles.artwork} ${compact ? styles.artworkCompact : ""}`} style={artworkStyle} aria-hidden="true">
      <span className={`${styles.motif} ${styles[`motif_${content.thumbnail_motif}`]}`} />
      <span className={styles.artCode}>{content.id.slice(-2)}</span>
      <span className={styles.artLabel}>PLAY / {content.category_id.toUpperCase()}</span>
    </div>
  );
}

export function HomeLanding() {
  const [activeCategory, setActiveCategory] = useState("all");
  const [menuOpen, setMenuOpen] = useState(false);
  const visibleContents = useMemo(() => activeCategory === "all" ? playContents : playContents.filter((content) => content.category_id === activeCategory), [activeCategory]);
  const featured = playContents.find((content) => content.is_featured) ?? playContents[0];

  const chooseCategory = (categoryId: string) => {
    setActiveCategory(categoryId);
    setMenuOpen(false);
    window.setTimeout(() => document.querySelector("#contents")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  };

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <a className={styles.brand} href="#top" aria-label="ODD PLAY 홈"><span className={styles.brandMark}>O</span><span>ODD<br />PLAY</span></a>
        <nav className={styles.desktopNav} aria-label="주요 카테고리">{categories.map((category) => <button key={category.id} onClick={() => chooseCategory(category.id)} type="button">{category.name}</button>)}</nav>
        <div className={styles.headerMeta}><span>5 CATEGORIES</span><i /><span>15 PLAYS</span></div>
        <button className={styles.menuButton} onClick={() => setMenuOpen((open) => !open)} type="button" aria-label="메뉴 열기" aria-expanded={menuOpen}>{menuOpen ? <X /> : <Menu />}</button>
      </header>

      {menuOpen && <nav className={styles.mobileMenu} aria-label="모바일 카테고리">{categories.map((category, index) => <button key={category.id} onClick={() => chooseCategory(category.id)} type="button"><span>0{index + 1}</span>{category.name}<ArrowUpRight size={18} /></button>)}</nav>}

      <section className={styles.hero} id="top">
        <div className={styles.heroCopy}>
          <p className={styles.kicker}><Sparkles size={15} /> 오늘 뭐 하고 놀지?</p>
          <h1><span>지루한 틈을</span><br />재밌게 <em>뒤집어.</em></h1>
          <p className={styles.heroDescription}>나를 발견하는 테스트부터 친구와 붙어보는 게임까지.<br className={styles.desktopBreak} /> 짧지만 확실한 재미를 골라보세요.</p>
          <button className={styles.heroCta} onClick={() => chooseCategory("all")} type="button">지금 둘러보기 <span><ArrowUpRight size={19} /></span></button>
        </div>
        <div className={styles.heroFeature}>
          <div className={styles.featureTape}>TODAY&apos;S PICK · TODAY&apos;S PICK ·</div>
          <Artwork content={featured} compact />
          <div className={styles.featureInfo}><span>{getCategory(featured.category_id)?.name}</span><strong>{featured.title}</strong><div><Users size={14} /> {formatParticipants(featured.participant_count)}명 참여 <i /> <Timer size={14} /> {featured.duration_minutes}분</div></div>
        </div>
      </section>

      <section className={styles.categoriesSection} aria-labelledby="category-title">
        <div className={styles.sectionTitle}><span>01 / CHOOSE A MOOD</span><h2 id="category-title">오늘의 플레이</h2><p>기분에 맞는 카테고리를 골라보세요.</p></div>
        <div className={styles.categoryGrid}>
          {categories.map((category, index) => {
            const Icon = categoryIcons[category.icon];
            return <button className={styles.categoryCard} key={category.id} onClick={() => chooseCategory(category.id)} type="button"><span className={styles.categoryNumber}>0{index + 1}</span><span className={styles.categoryIcon}><Icon size={25} strokeWidth={1.8} /></span><strong>{category.name}</strong><small>{category.description}</small><ArrowUpRight className={styles.categoryArrow} size={20} /></button>;
          })}
        </div>
      </section>

      <section className={styles.contentsSection} id="contents" aria-labelledby="contents-title">
        <div className={styles.contentsHeader}><div className={styles.sectionTitle}><span>02 / PICK YOUR PLAY</span><h2 id="contents-title">{activeCategory === "all" ? "전체 콘텐츠" : getCategory(activeCategory)?.name}</h2></div><span className={styles.resultCount}>{String(visibleContents.length).padStart(2, "0")} RESULTS</span></div>
        <div className={styles.filterBar} aria-label="콘텐츠 필터">
          <button className={activeCategory === "all" ? styles.activeFilter : ""} onClick={() => setActiveCategory("all")} type="button">전체</button>
          {categories.map((category) => <button className={activeCategory === category.id ? styles.activeFilter : ""} key={category.id} onClick={() => setActiveCategory(category.id)} type="button">{category.name}</button>)}
        </div>
        <div className={styles.contentGrid}>
          {visibleContents.map((content) => <article className={styles.contentCard} key={content.id}><Artwork content={content} /><div className={styles.cardBody}><div className={styles.cardCategory}>{getCategory(content.category_id)?.name}<span>준비 중</span></div><h3>{content.title}</h3><p>{content.summary}</p><div className={styles.cardMeta}><span><Users size={14} /> {formatParticipants(content.participant_count)}명</span><span><Timer size={14} /> 약 {content.duration_minutes}분</span></div></div></article>)}
        </div>
      </section>

      <footer className={styles.footer}><div><span className={styles.brandMark}>O</span><strong>ODD PLAY</strong></div><p>심심한 순간을 위한 작은 놀이터.<br />새로운 플레이가 계속 추가됩니다.</p><span>© 2026 ODD PLAY</span></footer>
      <nav className={styles.bottomNav} aria-label="하단 메뉴"><button className={activeCategory === "all" ? styles.bottomActive : ""} onClick={() => chooseCategory("all")} type="button"><Sparkles /><span>홈</span></button><button onClick={() => chooseCategory("psychology")} type="button"><BrainCircuit /><span>테스트</span></button><button onClick={() => chooseCategory("minigame")} type="button"><Gamepad2 /><span>게임</span></button></nav>
    </main>
  );
}
