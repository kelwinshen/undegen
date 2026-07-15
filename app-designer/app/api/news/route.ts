import { NextResponse } from "next/server";

export async function GET() {
  const apiKey = process.env.API_NEWS;

  if (!apiKey) {
    return NextResponse.json(
      { error: "API key not configured" },
      { status: 500 }
    );
  }

  try {
    const response = await fetch(
      `https://newsapi.org/v2/everything?q=fifa&sortBy=popularity&apiKey=${apiKey}`,
      { next: { revalidate: 3600 } }
    );

    if (!response.ok) {
      const errorData = await response.json();
      return NextResponse.json(
        { error: errorData.message || "Failed to fetch news" },
        { status: response.status }
      );
    }

    const data = await response.json();

    if (data.articles && Array.isArray(data.articles)) {
      data.articles = data.articles.map((article: any) => {
        if (article.urlToImage) {
          article.urlToImage = `/api/news/proxy-image?url=${encodeURIComponent(article.urlToImage)}`;
        }
        return article;
      });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("News API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
