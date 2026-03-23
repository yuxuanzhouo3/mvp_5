"use client";

import React, { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const MarkdownRenderer = ReactMarkdown as unknown as React.ComponentType<{
  children: string;
  remarkPlugins?: unknown[];
}>;

interface PrivacyPolicyContentProps {
  isDomestic: boolean;
}

export function PrivacyPolicyContent({ isDomestic }: PrivacyPolicyContentProps) {
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadContent = async () => {
      try {
        const fileName = isDomestic ? "隐私与政策（国内版）.md" : "隐私与政策（国际版）.md";
        const response = await fetch(`/docs/${fileName}`);
        const text = await response.text();
        setContent(text);
      } catch (error) {
        console.error("Failed to load privacy policy:", error);
        setContent(isDomestic ? "加载隐私政策失败" : "Failed to load privacy policy");
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
      <MarkdownRenderer remarkPlugins={[remarkGfm]}>{content}</MarkdownRenderer>
    </div>
  );
}
