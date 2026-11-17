"use client";

/**
 * 服务端优先的持久化 Hook（小飞改造版）
 *
 * 1) 服务端优先：优先读写本站 /api/data（服务端 store.json + 多层历史备份），
 *    接口不可用时自动退回 localStorage，离线/纯静态打开仍可用。
 * 2) 多班级：key 自动带当前班级前缀。c1 用原始 key（兼容既有数据），
 *    其余班级用 c2_、c3_ 前缀，各班级数据互不可见。
 */

import { useEffect, useState } from "react";

const API = "/api/data";
const CLASS_LS = "tw-class-id";

// 服务端 key 只允许字母数字下划线连字符，把 "homeroom.tasks.v1" 归一化成 "homeroom_tasks_v1"
const baseKey = (key: string) => key.replace(/[^A-Za-z0-9_-]+/g, "_");

function classPrefix(): string {
  try {
    const id = window.localStorage.getItem(CLASS_LS) || "c1";
    return id === "c1" ? "" : id + "_";
  } catch {
    return "";
  }
}

const mapKey = (key: string) => classPrefix() + baseKey(key);

async function readRemote(key: string): Promise<unknown | undefined> {
  try {
    const res = await fetch(API, { credentials: "same-origin", cache: "no-store" });
    if (!res.ok) return undefined;
    const doc = await res.json();
    const data = doc && typeof doc === "object" ? (doc as { data?: Record<string, unknown> }).data : undefined;
    return data ? data[mapKey(key)] : undefined;
  } catch {
    return undefined;
  }
}

async function writeRemote(key: string, value: unknown): Promise<void> {
  try {
    await fetch(API, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: mapKey(key), value }),
    });
  } catch {
    // 服务端不可达时忽略：本机 localStorage 仍有一份
  }
}

export function usePersistentState<T>(key: string, initialValue: T) {
  const [value, setValue] = useState<T>(initialValue);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const remote = await readRemote(key);
        if (cancelled) return;
        if (remote !== undefined) {
          setValue(remote as T);
        } else {
          // 服务端还没有这条数据，先看本机有没有旧缓存
          const local = window.localStorage.getItem(mapKey(key));
          if (local) setValue(JSON.parse(local) as T);
        }
      } catch {
        // 保留内置演示数据
      } finally {
        if (!cancelled) setIsHydrated(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [key]);

  useEffect(() => {
    if (!isHydrated) return;
    const k = mapKey(key);

    // 本机留一份，断网也能用
    try {
      window.localStorage.setItem(k, JSON.stringify(value));
    } catch {
      // 浏览器存储不可用时忽略
    }

    // 防抖写回服务端，避免每个击键都落盘
    const timer = window.setTimeout(() => {
      void writeRemote(key, value);
    }, 400);

    return () => window.clearTimeout(timer);
  }, [isHydrated, key, value]);

  return [value, setValue, isHydrated] as const;
}
