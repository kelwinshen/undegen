"use client";

import React, { useState, useEffect } from "react";

interface NewsArticle {
  source: { id: string | null; name: string };
  author: string | null;
  title: string;
  description: string | null;
  url: string;
  urlToImage: string | null;
  publishedAt: string;
  content: string | null;
}

function formatDate(dateStr: string) {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function timeAgo(dateStr: string) {
  const now = new Date();
  const date = new Date(dateStr);
  const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function ArticleSkeleton() {
  return (
    <div className="group rounded-2xl border border-border-low overflow-hidden animate-pulse">
      <div className="w-full h-48 bg-foreground/10" />
      <div className="p-5 space-y-3">
        <div className="h-3 bg-foreground/10 rounded w-1/3" />
        <div className="h-5 bg-foreground/10 rounded w-full" />
        <div className="h-5 bg-foreground/10 rounded w-4/5" />
        <div className="h-3 bg-foreground/10 rounded w-full" />
        <div className="h-3 bg-foreground/10 rounded w-2/3" />
        <div className="flex justify-between items-center pt-2">
          <div className="h-3 bg-foreground/10 rounded w-1/4" />
          <div className="h-3 bg-foreground/10 rounded w-1/5" />
        </div>
      </div>
    </div>
  );
}

function ArticleCard({ article }: { article: NewsArticle }) {
  const [imgError, setImgError] = useState(false);

  const hasImage = article.urlToImage && !imgError;

  return (
    <a
      href={article.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex flex-col rounded-2xl border border-border-low bg-card/60 backdrop-blur-sm overflow-hidden hover:border-foreground/20 dark:hover:border-white/15 hover:shadow-lg hover:shadow-foreground/5 transition-all duration-300 hover:-translate-y-0.5"
    >
      {/* Image */}
      <div className="relative w-full h-48 overflow-hidden bg-foreground/5 flex-shrink-0">
        {hasImage ? (
          <img
            src={article.urlToImage!}
            alt={article.title}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            {/* FIFA ball icon placeholder */}
            <svg
              className="w-16 h-16 text-foreground/10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 2a10 10 0 0 1 0 20A10 10 0 0 1 12 2z" />
              <path d="M12 6l3 3-1 5H10L9 9l3-3z" />
              <path d="M6.5 10.5l2.5.5M15 11l2.5-.5M9 16l1-2M14 14l1 2" />
            </svg>
          </div>
        )}
        {/* Source badge */}
        <div className="absolute top-3 left-3">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wider uppercase bg-background/80 dark:bg-black/70 backdrop-blur-sm border border-border-low text-foreground">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            {article.source.name}
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-col flex-1 p-5 gap-3">
        {/* Title */}
        <h3 className="text-sm font-bold leading-snug text-foreground line-clamp-2 group-hover:text-foreground/80 transition-colors">
          {article.title}
        </h3>

        {/* Description */}
        {article.description && (
          <p className="text-xs text-muted leading-relaxed line-clamp-3 flex-1">
            {article.description}
          </p>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between mt-auto pt-3 border-t border-border-low">
          <span className="text-[10px] text-muted font-medium truncate max-w-[60%]">
            {article.author
              ? article.author.split(",")[0].slice(0, 30)
              : "FIFA News"}
          </span>
          <span className="text-[10px] text-muted font-mono">
            {timeAgo(article.publishedAt)}
          </span>
        </div>
      </div>

      {/* Read more indicator */}
      <div className="px-5 pb-4">
        <div className="flex items-center gap-1.5 text-[10px] font-bold tracking-widest uppercase text-muted group-hover:text-foreground transition-colors duration-200">
          Read Article
          <svg
            className="w-3 h-3 transition-transform duration-200 group-hover:translate-x-0.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth="2.5"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"
            />
          </svg>
        </div>
      </div>
    </a>
  );
}

export default function FIFANewsPage() {
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "recent">("all");

  useEffect(() => {
    async function loadNews() {
      try {
        setIsLoading(true);
        setError(null);
        const res = await fetch("/api/news");
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to load news");
        }
        const data = await res.json();
        // Filter out articles with [Removed] titles
        const valid = (data.articles || []).filter(
          (a: NewsArticle) =>
            a.title &&
            a.title !== "[Removed]" &&
            a.url &&
            a.url !== "https://removed.com"
        );
        setArticles(valid);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load news");
      } finally {
        setIsLoading(false);
      }
    }
    loadNews();
  }, []);

  const filtered =
    filter === "recent"
      ? [...articles].sort(
          (a, b) =>
            new Date(b.publishedAt).getTime() -
            new Date(a.publishedAt).getTime()
        )
      : articles;

  return (
    <div className="relative min-h-screen overflow-x-clip bg-transparent text-foreground">
      <main className="relative z-10 mx-auto flex max-w-6xl min-h-screen flex-col gap-8 px-6 pt-28 pb-28 md:pb-12">
        {/* Header */}
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-foreground/5 border border-border-low">
              {/* Soccer ball */}
              <svg
                className="w-5 h-5 text-foreground"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M12 6l3 3-1 5H10L9 9l3-3z" />
                <path d="M6.5 10.5l2.5.5M15 11l2.5-.5M9 16l1-2M14 14l1 2" />
              </svg>
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground leading-none">
                FIFA News
              </h1>
              <p className="text-xs text-muted mt-0.5 font-medium tracking-wide">
                Powered by NewsAPI • Updated hourly
              </p>
            </div>
          </div>
          <p className="text-sm text-muted max-w-xl leading-relaxed">
            Stay up to date with the latest FIFA news, match previews, transfer
            updates, and tournament coverage from top sources worldwide.
          </p>

          {/* Filter tabs */}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={() => setFilter("all")}
              className={`px-4 py-1.5 rounded-full text-xs font-bold tracking-wider uppercase transition-all duration-200 cursor-pointer border ${
                filter === "all"
                  ? "bg-foreground text-background border-foreground"
                  : "bg-transparent text-muted border-border-low hover:border-foreground/20 hover:text-foreground"
              }`}
            >
              Most Popular
            </button>
            <button
              onClick={() => setFilter("recent")}
              className={`px-4 py-1.5 rounded-full text-xs font-bold tracking-wider uppercase transition-all duration-200 cursor-pointer border ${
                filter === "recent"
                  ? "bg-foreground text-background border-foreground"
                  : "bg-transparent text-muted border-border-low hover:border-foreground/20 hover:text-foreground"
              }`}
            >
              Most Recent
            </button>
            {!isLoading && articles.length > 0 && (
              <span className="ml-auto text-xs text-muted font-mono">
                {filtered.length} articles
              </span>
            )}
          </div>
        </div>

        {/* Error State */}
        {error && !isLoading && (
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
            <div className="w-16 h-16 rounded-full bg-rose-500/10 border border-rose-500/20 flex items-center justify-center">
              <svg
                className="w-7 h-7 text-rose-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-bold text-foreground">
                Failed to load news
              </p>
              <p className="text-xs text-muted mt-1">{error}</p>
            </div>
            <button
              onClick={() => window.location.reload()}
              className="px-5 py-2 rounded-full text-xs font-bold tracking-widest uppercase bg-foreground text-background hover:bg-foreground/90 transition-all cursor-pointer"
            >
              Retry
            </button>
          </div>
        )}

        {/* Loading Grid */}
        {isLoading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {Array.from({ length: 9 }).map((_, i) => (
              <ArticleSkeleton key={i} />
            ))}
          </div>
        )}

        {/* Articles Grid */}
        {!isLoading && !error && (
          <>
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
                <p className="text-sm font-bold text-foreground">
                  No articles found
                </p>
                <p className="text-xs text-muted">
                  Check back later for the latest FIFA news.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {filtered.map((article, idx) => (
                  <ArticleCard key={`${article.url}-${idx}`} article={article} />
                ))}
              </div>
            )}
          </>
        )}

        {/* Attribution */}
        {!isLoading && !error && articles.length > 0 && (
          <div className="flex items-center justify-center pt-4 pb-2">
            <p className="text-[10px] text-muted/50 font-medium tracking-wide text-center">
              News data provided by{" "}
              <a
                href="https://newsapi.org"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-muted transition-colors"
              >
                NewsAPI
              </a>{" "}
              • Articles open in official source
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
