"use client";

import React, { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { X, AlertCircle, Info, AlertTriangle } from "lucide-react";
import { SystemNotificationRow } from "@/lib/types/database";
import { cn } from "@/lib/utils/cn";

export function NotificationBanner() {
  const [notifications, setNotifications] = useState<SystemNotificationRow[]>([]);
  const [visible, setVisible] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    async function fetchNotifications() {
      try {
        const response = await fetch("/api/notifications");
        if (response.ok) {
          const data = await response.json();
          setNotifications(data);
          setCurrentIndex(0);
          setVisible(true);
        }
      } catch (error) {
        console.error("Failed to fetch notifications:", error);
      }
    }
    fetchNotifications();
  }, []);

  useEffect(() => {
    if (notifications.length <= 1) return;

    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % notifications.length);
    }, 5000);

    return () => clearInterval(interval);
  }, [notifications.length]);

  if (!visible || notifications.length === 0) {
    return null;
  }

  const notification = notifications[currentIndex];

  const levelStyles = {
    info: "bg-blue-50/90 text-blue-900 border-blue-200 dark:bg-blue-950/50 dark:text-blue-100 dark:border-blue-800",
    warning: "bg-amber-50/90 text-amber-900 border-amber-200 dark:bg-amber-950/50 dark:text-amber-100 dark:border-amber-800",
    error: "bg-red-50/90 text-red-900 border-red-200 dark:bg-red-950/50 dark:text-red-100 dark:border-red-800",
  };

  const Icon = {
    info: Info,
    warning: AlertTriangle,
    error: AlertCircle,
  }[notification.level] || Info;

  return (
    <div className={cn(
      "relative w-full border-b px-4 py-3 text-sm backdrop-blur-sm transition-all animate-in fade-in slide-in-from-top-2",
      levelStyles[notification.level] || levelStyles.info
    )}>
      <div className="mx-auto flex max-w-[1600px] items-start gap-3 md:items-center">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 md:mt-0" />
        <div className="flex-1 [&_a]:font-medium [&_a]:underline [&_a]:underline-offset-2 [&_p]:leading-relaxed">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {notification.message}
          </ReactMarkdown>
        </div>
        <button
          onClick={() => setVisible(false)}
          className="ml-2 rounded-full p-1 opacity-70 hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
        >
          <X className="h-4 w-4" />
          <span className="sr-only">关闭</span>
        </button>
      </div>
    </div>
  );
}
