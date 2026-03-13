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
    <div className="prose prose-sm dark:prose-invert max-w-none px-1 sm:px-2 lg:px-4">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: ({ children }) => (
            <div className="overflow-x-auto my-3 sm:my-4 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm -mx-2 sm:-mx-1 lg:mx-0">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-[10px] sm:text-xs lg:text-sm">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-900/30 dark:to-teal-900/30">
              {children}
            </thead>
          ),
          th: ({ children }) => (
            <th className="px-1.5 sm:px-2 lg:px-3 py-1 sm:py-1.5 lg:py-2 text-left text-[9px] sm:text-[10px] lg:text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wider whitespace-nowrap">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-1.5 sm:px-2 lg:px-3 py-1 sm:py-1.5 lg:py-2 text-[10px] sm:text-xs lg:text-sm text-gray-600 dark:text-gray-300 border-t border-gray-100 dark:border-gray-700 whitespace-nowrap">
              {children}
            </td>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
