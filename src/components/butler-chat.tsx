"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { TodayRevisionCard } from "./today-revision";
import { useUserId } from "./auth-context";
import { createClient } from "@/lib/supabase/client";
import { confirmMemory, dbFailure, sendChat, validateChat } from "@/lib/butler";
import type {
  ChatMessage,
  ChatSession,
  Goal,
  Memory,
} from "@/lib/supabase/database.types";
import type { PlanPreview } from "@/lib/ai-plan";
import type {
  ChatReply,
  MemoryProposal,
} from "../../supabase/functions/_shared/chat-schema";
export function ButlerChat({
  preview = null,
  onRevision,
}: {
  preview?: PlanPreview | null;
  onRevision?: (preview: PlanPreview) => void;
}) {
  const userId = useUserId();
  const messageList = useRef<HTMLDivElement>(null);
  const loadingOlder = useRef(false);
  const [sessions, setSessions] = useState<ChatSession[]>([]),
    [session, setSession] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]),
    [memories, setMemories] = useState<Memory[]>([]),
    [goals, setGoals] = useState<Goal[]>([]);
  const [canRetry, setCanRetry] = useState(false);
  const [draft, setDraft] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [history, setHistory] = useState(false),
    [hasOlder, setHasOlder] = useState(false);
  const [editing, setEditing] = useState<Memory | null>(null),
    [editValue, setEditValue] = useState("");
  const lock = useRef(false),
    retry = useRef<{
      id: string;
      content: string;
      session: string;
      preview: PlanPreview | null;
    } | null>(null),
    ids = useRef(new Map<string, string>());
  const actionId = (key: string) => {
    if (!ids.current.has(key)) ids.current.set(key, crypto.randomUUID());
    return ids.current.get(key)!;
  };
  const refreshSide = useCallback(async () => {
    const db = createClient();
    const [m, g, s] = await Promise.all([
      db
        .from("memories")
        .select("*")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false }),
      db
        .from("goals")
        .select("*")
        .eq("user_id", userId)
        .eq("status", "active")
        .order("created_at"),
      db
        .from("chat_sessions")
        .select("*")
        .eq("user_id", userId)
        .eq("archived", false)
        .order("updated_at", { ascending: false }),
    ]);
    if (m.error || g.error || s.error)
      throw dbFailure(m.error ?? g.error ?? s.error);
    setMemories(m.data);
    setGoals(g.data);
    setSessions(s.data);
    return s.data;
  }, [userId]);
  const loadMessages = useCallback(
    async (id: string, older = false) => {
      let query = createClient()
        .from("chat_messages")
        .select("*")
        .eq("user_id", userId)
        .eq("session_id", id)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false });
      // Increasing the visible window keeps equal-timestamp messages intact.
      query = query.limit(older ? messages.length + 40 : 40);
      const { data, error } = await query;
      if (error) throw dbFailure(error);
      loadingOlder.current = older;
      setMessages(data.reverse());
      setHasOlder(data.length === (older ? messages.length + 40 : 40));
    },
    [userId, messages.length],
  );
  useEffect(() => {
    let live = true;
    Promise.resolve()
      .then(refreshSide)
      .then((s) => {
        if (live) setSession(s[0]?.id ?? "");
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [refreshSide]);
  useEffect(() => {
    if (!session) return;
    let live = true;
    createClient()
      .from("chat_messages")
      .select("*")
      .eq("user_id", userId)
      .eq("session_id", session)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(40)
      .then(({ data, error }) => {
        if (!live) return;
        if (error) setError(dbFailure(error).message);
        else {
          setMessages(data.reverse());
          setHasOlder(data.length === 40);
        }
        setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [session, userId]);
  useEffect(() => {
    if (!loadingOlder.current && messageList.current)
      messageList.current.scrollTop = messageList.current.scrollHeight;
    loadingOlder.current = false;
  }, [messages]);
  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败，请重试。");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function newSession() {
    const id = crypto.randomUUID();
    const { error } = await createClient()
      .from("chat_sessions")
      .insert({
        id,
        user_id: userId,
        title: draft.trim().slice(0, 60) || "新的对话",
      });
    if (error) throw dbFailure(error);
    await refreshSide();
    setSession(id);
    setMessages([]);
    retry.current = null;
    setCanRetry(false);
    return id;
  }
  async function send(repeat = false) {
    await run(async () => {
      const text = repeat ? retry.current?.content : draft.trim();
      if (!text) return;
      const selected = repeat
        ? retry.current!.session
        : session || (await newSession());
      const request =
        repeat ||
        (retry.current?.content === text && retry.current.session === selected)
          ? retry.current!
          : {
              id: crypto.randomUUID(),
              content: text,
              session: selected,
              preview,
            };
      retry.current = request;
      setCanRetry(true);
      try {
        await sendChat(selected, request.id, request.content, request.preview);
        setDraft("");
        retry.current = null;
        setCanRetry(false);
      } finally {
        await loadMessages(selected);
      }
    });
  }
  async function decision(message: ChatMessage, value: string) {
    const { error } = await createClient()
      .from("chat_messages")
      .update({ metadata: { ...message.metadata, memory_decision: value } })
      .eq("id", message.id)
      .eq("user_id", userId)
      .select("id")
      .single();
    if (error) throw dbFailure(error);
    await loadMessages(session);
  }
  async function acceptMemory(message: ChatMessage, p: MemoryProposal) {
    await confirmMemory(
      p,
      typeof message.metadata.expected_memory === "string"
        ? message.metadata.expected_memory
        : null,
      message.id,
      actionId(message.id),
    );
    await decision(message, "confirmed");
    await refreshSide();
  }
  function result(message: ChatMessage): ChatReply | null {
    try {
      return message.role === "assistant"
        ? validateChat(message.metadata.result)
        : null;
    } catch {
      return null;
    }
  }
  const visible = memories.filter((m) => history || m.status === "active");
  return (
    <div className="butler-layout">
      <section className="card chat-panel" aria-label="管家对话">
        <div className="section-heading">
          <h2>和管家聊聊</h2>
          <button
            className="secondary-button"
            disabled={busy || loading}
            onClick={() =>
              run(async () => {
                await newSession();
              })
            }
          >
            新对话
          </button>
        </div>
        <label>
          当前会话
          <select
            value={session}
            disabled={busy || loading}
            onChange={(e) => {
              setSession(e.target.value);
              retry.current = null;
              setError("");
            }}
          >
            <option value="" disabled>
              选择或创建对话
            </option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title} · {new Date(s.created_at).toLocaleDateString("zh-CN")}
              </option>
            ))}
          </select>
        </label>
        <button
          className="text-button"
          disabled={busy || loading}
          onClick={() =>
            run(async () => {
              const s = await refreshSide();
              if (session) await loadMessages(session);
              else setSession(s[0]?.id ?? "");
            })
          }
        >
          刷新云端聊天与记忆
        </button>
        <p className="card-footnote">
          聊天会保存到云端。管家只读取当前有效记忆、近期计划和部分最近对话；重要信息由你确认后才成为长期记忆。
        </p>
        {preview && (
          <p className="draft-warning">
            正在讨论 {preview.plan_date} 的计划预览，聊天不会直接保存计划。
          </p>
        )}
        <div className="chat-messages" aria-live="polite" ref={messageList}>
          {loading && <p role="status">正在读取云端对话……</p>}
          {hasOlder && (
            <button
              disabled={busy}
              className="secondary-button"
              onClick={() => run(() => loadMessages(session, true))}
            >
              查看更早消息
            </button>
          )}
          {!loading && !messages.length && (
            <p className="muted">
              最近有什么想聊的？可以说说明天的安排，也可以一起理清一个想法。
            </p>
          )}
          {messages.map((m) => {
            const r = result(m);
            return (
              <article key={m.id} className={`chat-bubble ${m.role}`}>
                <small>
                  {m.role === "user" ? "我" : "成长管家"} ·{" "}
                  {new Date(m.created_at).toLocaleTimeString("zh-CN", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </small>
                <p className="preserve-lines">{m.content}</p>
                {m.role === "user" && m.metadata.state === "failed" && (
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => {
                      retry.current = {
                        id: m.id,
                        content: m.content,
                        session: m.session_id,
                        preview,
                      };
                      send(true);
                    }}
                  >
                    重试这条消息
                  </button>
                )}
                {r?.memory_proposal && !m.metadata.memory_decision && (
                  <div className="memory-proposal">
                    <strong>是否更新为当前长期信息？</strong>
                    <p>
                      {r.memory_proposal.action === "invalidate"
                        ? "设为失效："
                        : "更新："}
                      {r.memory_proposal.value}
                    </p>
                    <small>
                      {r.memory_proposal.category} / {r.memory_proposal.key}
                    </small>
                    <div className="preview-actions">
                      <button
                        disabled={busy}
                        className="primary-button"
                        onClick={() =>
                          run(() => acceptMemory(m, r.memory_proposal!))
                        }
                      >
                        更新记忆
                      </button>
                      <button
                        disabled={busy}
                        className="secondary-button"
                        onClick={() => run(() => decision(m, "session_only"))}
                      >
                        仅本次使用
                      </button>
                      <button
                        disabled={busy}
                        className="secondary-button"
                        onClick={() => run(() => decision(m, "rejected"))}
                      >
                        不要记
                      </button>
                    </div>
                  </div>
                )}
                {!!m.metadata.memory_decision && (
                  <p className="card-footnote">
                    {m.metadata.memory_decision === "confirmed"
                      ? "记忆更新已确认"
                      : m.metadata.memory_decision === "rejected"
                        ? "不加入长期记忆"
                        : "仅用于本次对话，不加入长期记忆"}
                  </p>
                )}
                {r?.today_revision && (
                  <TodayRevisionCard message={m} revision={r.today_revision} />
                )}
                {r?.plan_revision && (
                  <div className="memory-proposal">
                    <h3>建议的计划调整</h3>
                    <p>{r.plan_revision.adjustment_reason}</p>
                    <strong>{r.plan_revision.tomorrow_main_goal}</strong>
                    <ul>
                      {r.plan_revision.tasks.map((t, i) => (
                        <li key={i}>
                          {t.title} · {t.estimated_minutes} 分钟
                          <p>完成标准：{t.success_criteria}</p>
                        </li>
                      ))}
                    </ul>
                    {onRevision &&
                    preview &&
                    JSON.stringify(m.metadata.preview) ===
                      JSON.stringify(preview) ? (
                      <button
                        disabled={busy}
                        className="secondary-button"
                        onClick={() =>
                          onRevision({ ...preview, proposal: r.plan_revision! })
                        }
                      >
                        应用这次调整到预览
                      </button>
                    ) : (
                      <p className="card-footnote">
                        预览已改变或不在当前页面，请在最新预览旁继续讨论。
                      </p>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        <form
          className="chat-composer"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <label htmlFor="butler-message">说说你的想法</label>
          <textarea
            id="butler-message"
            maxLength={4000}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={busy || loading}
            placeholder="例如：我今天临时有事，帮我重新排今天剩下的时间"
          />
          <div className="preview-actions">
            <button
              className="primary-button"
              disabled={busy || loading || !draft.trim()}
            >
              {busy ? "正在处理……" : "发送"}
            </button>
            {canRetry && (
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => send(true)}
              >
                重试上一条
              </button>
            )}
          </div>
        </form>
      </section>
      <aside className="butler-side">
        <section className="card">
          <h2>当前阶段目标</h2>
          {goals.length ? (
            goals.map((g) => <p key={g.id}>{g.title}</p>)
          ) : (
            <p className="muted">还没有进行中的目标。</p>
          )}
        </section>
        <section className="card">
          <div className="section-heading">
            <h2>管家记忆</h2>
            <button
              className="text-button"
              onClick={() => setHistory(!history)}
            >
              {history ? "只看有效" : "查看历史"}
            </button>
          </div>
          <p className="card-footnote">
            已替换和已失效的记忆不参与后续规划。删除不会删除原始聊天。
          </p>
          {!visible.length && (
            <p className="muted">
              暂无{history ? "" : "有效"}
              记忆。聊天中的重要信息会先征求你的确认。
            </p>
          )}
          {visible.map((m) => (
            <article className="memory-item" key={m.id}>
              <small>
                {m.category} / {m.key} ·{" "}
                {
                  {
                    active: "有效",
                    proposed: "待确认",
                    superseded: "已替换",
                    invalidated: "已失效",
                  }[m.status]
                }
              </small>
              <p className="preserve-lines">{m.value}</p>
              <small>
                更新于 {new Date(m.updated_at).toLocaleString("zh-CN")}
              </small>
              <div className="preview-actions">
                {m.status === "active" && (
                  <>
                    <button
                      disabled={busy}
                      className="text-button"
                      onClick={() => {
                        setEditing(m);
                        setEditValue(m.value);
                      }}
                    >
                      编辑
                    </button>
                    <button
                      disabled={busy}
                      className="text-button"
                      onClick={() =>
                        run(async () => {
                          await confirmMemory(
                            { ...m, action: "invalidate" },
                            m.id,
                            m.source_message_id,
                            actionId(`invalidate:${m.id}`),
                          );
                          await refreshSide();
                        })
                      }
                    >
                      设为失效
                    </button>
                  </>
                )}
                <button
                  disabled={busy}
                  className="text-button"
                  onClick={() => {
                    if (window.confirm("删除这条记忆？原始聊天仍保留。"))
                      run(async () => {
                        const { error } = await createClient()
                          .from("memories")
                          .delete()
                          .eq("id", m.id)
                          .eq("user_id", userId)
                          .eq("updated_at", m.updated_at)
                          .select("id")
                          .single();
                        if (error) throw dbFailure(error);
                        await refreshSide();
                      });
                  }}
                >
                  删除
                </button>
              </div>
            </article>
          ))}
          {editing && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => {
                  await confirmMemory(
                    { ...editing, value: editValue, action: "replace" },
                    editing.id,
                    editing.source_message_id,
                    actionId(`edit:${editing.id}:${editValue}`),
                  );
                  setEditing(null);
                  await refreshSide();
                });
              }}
            >
              <label>
                新的长期信息
                <textarea
                  maxLength={1200}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                />
              </label>
              <button
                disabled={busy || !editValue.trim()}
                className="primary-button"
              >
                确认替换记忆
              </button>
              <button
                type="button"
                disabled={busy}
                className="secondary-button"
                onClick={() => setEditing(null)}
              >
                取消
              </button>
            </form>
          )}
        </section>
      </aside>
    </div>
  );
}
