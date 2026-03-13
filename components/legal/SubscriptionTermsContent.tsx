"use client";

import React, { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface SubscriptionTermsContentProps {
  isDomestic: boolean;
}

export function SubscriptionTermsContent({ isDomestic }: SubscriptionTermsContentProps) {
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadContent = async () => {
      try {
        const fileName = isDomestic ? "订阅规则（国内版）.md" : "订阅规则（国际版）.md";
        const response = await fetch(`/docs/${fileName}`);
        const text = await response.text();
        setContent(text);
      } catch (error) {
        console.error("Failed to load subscription terms:", error);
        setContent(isDomestic ? "加载订阅规则失败" : "Failed to load subscription terms");
      } finally {
        setLoading(false);
      }
    };

    loadContent();
  }, [isDomestic]);

  if (loading) {
    return <div className="text-center py-8 text-gray-500">加载中...</div>;
  }

  return (
    <div className="prose prose-sm dark:prose-invert max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}
