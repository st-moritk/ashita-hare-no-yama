"use client";

import { useEffect, useMemo, useState } from "react";

type Mountain = {
  id: string;
  index: string;
  name: string;
  reading: string;
  elevation: number;
  category: string;
  prefecture: string; // 表示用（ソート済み）
  prefectures: string[]; // 検索用（分割・ソート済み）
  latitude: number;
  longitude: number;
};

type WeatherInfo = {
  code: number;
  precipitationProbability: number | null;
};

type SunnyMountain = Mountain & {
  weather: WeatherInfo;
};

type ScanState = "idle" | "loading" | "done";

const SUNNY_CODES = new Set([0, 1]);

const PREFECTURE_ORDER = [
  "北海道",
  "青森県",
  "岩手県",
  "宮城県",
  "秋田県",
  "山形県",
  "福島県",
  "茨城県",
  "栃木県",
  "群馬県",
  "埼玉県",
  "千葉県",
  "東京都",
  "神奈川県",
  "新潟県",
  "富山県",
  "石川県",
  "福井県",
  "山梨県",
  "長野県",
  "岐阜県",
  "静岡県",
  "愛知県",
  "三重県",
  "滋賀県",
  "京都府",
  "大阪府",
  "兵庫県",
  "奈良県",
  "和歌山県",
  "鳥取県",
  "島根県",
  "岡山県",
  "広島県",
  "山口県",
  "徳島県",
  "香川県",
  "愛媛県",
  "高知県",
  "福岡県",
  "佐賀県",
  "長崎県",
  "熊本県",
  "大分県",
  "宮崎県",
  "鹿児島県",
  "沖縄県",
];

function splitAndOrderPrefectures(input: string): string[] {
  const parts = input
    .split(/[・,、／/，]/)
    .map((p) => p.trim())
    .filter(Boolean);

  const unique = Array.from(new Set(parts));

  return unique.sort((a, b) => {
    const ai = PREFECTURE_ORDER.indexOf(a);
    const bi = PREFECTURE_ORDER.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b, "ja");
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

const WEATHER_LABEL: Record<number, string> = {
  0: "快晴",
  1: "ほぼ快晴",
  2: "薄曇り",
  3: "曇り",
  45: "霧",
  48: "氷霧",
  51: "弱い霧雨",
  53: "霧雨",
  55: "強い霧雨",
  61: "小雨",
  63: "雨",
  65: "大雨",
  71: "小雪",
  73: "雪",
  75: "大雪",
  77: "雪粒",
  80: "にわか雨",
  81: "強いにわか雨",
  82: "激しいにわか雨",
  85: "にわか雪",
  86: "強いにわか雪",
  95: "雷雨",
  96: "ひょう混じり雷雨",
  99: "ひょう混じり激しい雷雨",
};

function parseMountains(csvText: string): Mountain[] {
  const lines = csvText.trim().split(/\r?\n/);
  const header = lines.shift() ?? "";
  const sanitizedHeader = header.replace(/^\uFEFF/, "");
  const columns = sanitizedHeader.split(",");

  // Fallback to positional mapping because the CSV uses固定列順.
  const nameIndex = columns.findIndex((c) => c.includes("山名"));
  const readingIndex = columns.findIndex((c) => c.includes("よみ"));
  const prefectureIndex = columns.findIndex((c) => c.includes("都道府県"));

  return lines
    .map((line) => line.split(","))
    .filter((cells) => cells.length >= 9)
    .map((cells) => {
      const latitude = Number(cells[7]);
      const longitude = Number(cells[8]);
      const elevation = Number(cells[4]);
      const rawPrefecture = cells[prefectureIndex] ?? cells[6];
      const prefectures = splitAndOrderPrefectures(rawPrefecture);
      const prefectureLabel = prefectures.length
        ? prefectures.join("・")
        : rawPrefecture;

      if (Number.isNaN(latitude) || Number.isNaN(longitude)) return null;

      return {
        id: cells[0],
        index: cells[1],
        name: cells[nameIndex] ?? cells[2],
        reading: cells[readingIndex] ?? cells[3],
        elevation: Number.isNaN(elevation) ? 0 : elevation,
        category: cells[5],
        prefecture: prefectureLabel,
        prefectures,
        latitude,
        longitude,
      };
    })
    .filter((entry): entry is Mountain => Boolean(entry));
}

function tomorrowDate() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return {
    iso: d.toISOString().slice(0, 10),
    label: new Intl.DateTimeFormat("ja-JP", {
      month: "numeric",
      day: "numeric",
      weekday: "short",
    }).format(d),
  };
}

async function fetchWeather(
  mountain: Mountain,
  tomorrowIso: string,
): Promise<WeatherInfo | null> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.search = new URLSearchParams({
    latitude: mountain.latitude.toString(),
    longitude: mountain.longitude.toString(),
    daily: "weathercode,precipitation_probability_max",
    timezone: "auto",
  }).toString();

  try {
    const response = await fetch(url.toString());
    if (!response.ok) return null;
    const data = await response.json();
    const times: string[] | undefined = data?.daily?.time;
    const index = times?.indexOf(tomorrowIso);
    if (index === undefined || index < 0) return null;
    const codes: number[] | undefined = data?.daily?.weathercode;
    const probability: number[] | undefined =
      data?.daily?.precipitation_probability_max;
    const code = codes?.[index];
    if (typeof code !== "number") return null;
    return {
      code,
      precipitationProbability:
        typeof probability?.[index] === "number" ? probability[index] : null,
    };
  } catch (error) {
    console.error("weather fetch failed", error);
    return null;
  }
}

export default function Home() {
  const [{ iso: tomorrowIso, label: tomorrowLabel }] = useState(tomorrowDate);
  const [mountains, setMountains] = useState<Mountain[]>([]);
  const [loadingCsv, setLoadingCsv] = useState(true);
  const [prefecture, setPrefecture] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [maxChecks, setMaxChecks] = useState(24);
  const [sunnyMountains, setSunnyMountains] = useState<SunnyMountain[]>([]);
  const [scanState, setScanState] = useState<ScanState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ completed: number; total: number }>({
    completed: 0,
    total: 0,
  });

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/1003zan20250401.csv");
        if (!res.ok) throw new Error("CSV取得に失敗しました");
        const text = await res.text();
        const parsed = parseMountains(text);
        setMountains(parsed);
      } catch (err) {
        console.error(err);
        setMessage("CSVの読み込みに失敗しました。リロードして再度お試しください。");
      } finally {
        setLoadingCsv(false);
      }
    };
    load();
  }, []);

  const prefectures = useMemo(() => {
    const set = new Set(
      mountains
        .flatMap((m) => m.prefectures)
        .map((p) => p.trim())
        .filter((p) => p && p !== "都道府県"),
    );
    const list = Array.from(set);
    return list.sort((a, b) => {
      const ai = PREFECTURE_ORDER.indexOf(a);
      const bi = PREFECTURE_ORDER.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b, "ja");
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  }, [mountains]);

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim();
    return mountains
      .filter((m) => {
        const matchPref =
          prefecture === "all" || m.prefectures.includes(prefecture);
        const matchQuery =
          !normalizedQuery ||
          m.name.includes(normalizedQuery) ||
          m.reading.includes(normalizedQuery);
        return matchPref && matchQuery;
      })
      .sort((a, b) => b.elevation - a.elevation);
  }, [mountains, prefecture, query]);

  const targetMountains = useMemo(
    () => filtered.slice(0, maxChecks),
    [filtered, maxChecks],
  );

  const handleScan = async () => {
    if (!targetMountains.length) {
      setMessage("対象の山がありません。条件を変えてください。");
      return;
    }

    setScanState("loading");
    setSunnyMountains([]);
    setMessage("Open-Meteoでチェック中...");
    setProgress({ completed: 0, total: targetMountains.length });

    const hits: SunnyMountain[] = [];
    const batchSize = 8;

    for (let i = 0; i < targetMountains.length; i += batchSize) {
      const batch = targetMountains.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(async (mountain) => {
          const weather = await fetchWeather(mountain, tomorrowIso);
          if (!weather || !SUNNY_CODES.has(weather.code)) return null;
          return {
            ...mountain,
            weather,
          };
        }),
      );
      hits.push(...(results.filter(Boolean) as SunnyMountain[]));
      setProgress({
        completed: Math.min(i + batch.length, targetMountains.length),
        total: targetMountains.length,
      });
    }

    setSunnyMountains(hits);
    setScanState("done");
    setMessage(
      hits.length
        ? `明日(${tomorrowLabel})に晴れそうな山が${hits.length}件見つかりました`
        : "明日晴れの条件に合う山は見つかりませんでした",
    );
  };

  return (
    <div className="min-h-screen bg-transparent text-slate-900">
      <main className="mx-auto flex max-w-6xl flex-col gap-10 px-6 py-10 md:px-10 lg:px-16">
        <section className="glass relative overflow-hidden rounded-3xl px-6 py-8 sm:px-10 sm:py-12">
          <div className="absolute inset-0 bg-gradient-to-br from-sky-100/60 via-white to-rose-50/60" />
          <div className="relative flex flex-col gap-6">
            <div className="inline-flex items-center gap-2 self-start rounded-full bg-slate-900 text-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em]">
              <span className="inline-block h-2 w-2 rounded-full bg-lime-400 shadow-[0_0_0_6px_rgba(190,242,100,0.25)]" />
              Open-Meteo × 日本の山
            </div>
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div className="space-y-3">
                <h1 className="text-3xl font-semibold leading-tight text-slate-900 sm:text-4xl md:text-5xl">
                  明日はれの山
                </h1>
                <p className="max-w-3xl text-lg text-slate-700">
                  `public/1003zan20250401.csv` を読み込み、Open-Meteoの予報から
                  「明日晴れ」になりそうな山だけを抽出します。都道府県や山名で絞り込んでからチェックすると軽快です。
                </p>
                <div className="flex flex-wrap gap-3 text-sm text-slate-700">
                  <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-2 shadow-sm ring-1 ring-slate-100">
                    対象日: 明日（{tomorrowLabel}）
                  </span>
                  <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-2 shadow-sm ring-1 ring-slate-100">
                    データ件数: {mountains.length || "-"} 山
                  </span>
                  <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-2 shadow-sm ring-1 ring-slate-100">
                    晴れ判定: weathercode 0 / 1
                  </span>
                </div>
              </div>
              <div className="rounded-2xl bg-white px-4 py-4 text-sm shadow-lg ring-1 ring-slate-100">
                <p className="text-xs font-semibold text-slate-500">How it works</p>
                <ul className="mt-2 space-y-1 text-slate-700">
                  <li>1. CSVをクライアントで読み込み</li>
                  <li>2. 条件で山を絞り込み</li>
                  <li>3. Open-Meteoで明日のweathercodeを取得</li>
                  <li>4. 晴れの山だけカード表示</li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        <section className="card-surface rounded-3xl px-6 py-6 sm:px-8 sm:py-8">
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
                フィルター
              </p>
              <h2 className="text-2xl font-semibold text-slate-900">
                山リストから候補をしぼる
              </h2>
              <p className="text-sm text-slate-600">
                条件に合う山から最大 {maxChecks} 件まで Open-Meteo に問い合わせます。
                件数が多いほど時間がかかるので、エリアや山名で絞るのがおすすめです。
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-slate-700">
                  都道府県
                </label>
                <select
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-900 shadow-sm outline-none ring-amber-200 focus:ring-2"
                  value={prefecture}
                  onChange={(e) => setPrefecture(e.target.value)}
                >
                  <option value="all">すべて</option>
                  {prefectures.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-slate-700">
                  山名・よみで検索
                </label>
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="例: 富士, やりがたけ"
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-900 shadow-sm outline-none ring-amber-200 focus:ring-2"
                />
              </div>
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between text-sm">
                  <label className="font-medium text-slate-700">
                    Open-Meteoに問い合わせる件数
                  </label>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">
                    {maxChecks} 件
                  </span>
                </div>
                <input
                  type="range"
                  min={8}
                  max={60}
                  step={4}
                  value={maxChecks}
                  onChange={(e) => setMaxChecks(Number(e.target.value))}
                  className="accent-amber-500"
                />
                <p className="text-xs text-slate-500">
                  抽出対象: {targetMountains.length} / {filtered.length} 件
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-slate-600">
                CSV読み込み:
                <span className="ml-2 font-semibold text-slate-800">
                  {loadingCsv ? "読み込み中..." : `${mountains.length}件`}
                </span>
              </div>
              <button
                onClick={handleScan}
                disabled={scanState === "loading" || loadingCsv}
                className="inline-flex items-center justify-center gap-3 rounded-2xl bg-slate-900 px-6 py-3 text-white shadow-lg shadow-slate-900/15 transition hover:-translate-y-0.5 hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                {scanState === "loading" ? (
                  <>
                    <span className="h-2 w-2 animate-pulse rounded-full bg-lime-400" />
                    チェック中...
                  </>
                ) : (
                  <>
                    <span className="h-2 w-2 rounded-full bg-lime-400" />
                    明日晴れの山を探す
                  </>
                )}
              </button>
            </div>
            <div className="flex flex-wrap gap-4 text-sm text-slate-700">
              <div className="flex items-center gap-2 rounded-full bg-slate-100 px-3 py-2">
                <span className="h-2 w-2 rounded-full bg-amber-500" />
                Progress: {progress.completed} / {progress.total}
              </div>
              {message && (
                <div className="flex items-center gap-2 rounded-full bg-white px-3 py-2 shadow-sm ring-1 ring-slate-100">
                  {message}
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="space-y-6">
          <div className="flex flex-col gap-2">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
              Results
            </p>
            <h2 className="text-2xl font-semibold text-slate-900">
              明日晴れそうな山 {sunnyMountains.length ? `(${sunnyMountains.length} 件)` : ""}
            </h2>
            <p className="text-sm text-slate-600">
              Open-Meteo の weathercode が 0 または 1 の山だけを表示します。
              各カードには山頂の座標と標高、降水確率の目安も載せています。
            </p>
          </div>

          {!sunnyMountains.length && scanState === "done" && (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white/80 px-5 py-6 text-slate-700 shadow-sm">
              該当する山が見つかりませんでした。件数を増やすか、別のエリアを試してください。
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            {sunnyMountains.map((mountain) => {
              const weatherLabel = WEATHER_LABEL[mountain.weather.code] ?? "晴れ";
              return (
                <div
                  key={`${mountain.id}-${mountain.index}`}
                  className="card-surface relative overflow-hidden rounded-3xl px-5 py-6 transition hover:-translate-y-0.5 hover:shadow-xl"
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-amber-50/70 via-white to-sky-50/80" />
                  <div className="relative flex flex-col gap-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="space-y-1">
                        <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                          {mountain.prefecture} · {mountain.category}
                        </p>
                        <h3 className="text-xl font-semibold text-slate-900">
                          {mountain.name}
                        </h3>
                        <p className="text-sm text-slate-600">{mountain.reading}</p>
                      </div>
                      <div className="rounded-2xl bg-slate-900 px-4 py-3 text-right text-white shadow-lg shadow-slate-900/10">
                        <p className="text-xs text-slate-200">標高</p>
                        <p className="text-lg font-semibold">{mountain.elevation} m</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-sm text-slate-700">
                      <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-2 shadow-sm ring-1 ring-amber-100">
                        <span className="h-2 w-2 rounded-full bg-amber-500" />
                        {weatherLabel} (code {mountain.weather.code})
                      </span>
                      <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-2 shadow-sm ring-1 ring-slate-100">
                        降水確率:{" "}
                        {mountain.weather.precipitationProbability ?? "—"}
                        {typeof mountain.weather.precipitationProbability === "number"
                          ? "%"
                          : ""}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {scanState !== "done" && !sunnyMountains.length && (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white/80 px-5 py-6 text-slate-700 shadow-sm">
              条件を決めて「明日晴れの山を探す」を押すと結果がここに並びます。
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
