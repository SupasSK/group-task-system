#!/usr/bin/env bash
# เกณฑ์ฉบับที่ 4 KPI-4 ส่วนสแกน: ZAP baseline 2 ครั้ง และ npm audit --omit=dev 2 ครั้ง
# ZAP ใช้ image ที่ล็อก digest เดียวกับชุดเดิม (ZAP 2.17.0) ต้องเปิด Docker ก่อนรัน
# เกณฑ์: ZAP ไม่มี High และ Medium ทุกตัวต้องวิเคราะห์ในรายงาน (สคริปต์นี้แค่สรุปจำนวนตามระดับ), npm audit ไม่มี Critical
# วิธีรัน (Git Bash): bash v4-kpi4-scans.sh <round>
set -euo pipefail
ROUND="${1:?ใช้: bash v4-kpi4-scans.sh <round>}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
OUT="$ROOT/docs/evaluation/results"
URL="${GT_BASE_URL:-https://group-task-system.vercel.app}"
IMAGE="ghcr.io/zaproxy/zaproxy@sha256:5ccfff9a411743ab2615136a2edd7416bec9ce41572fa94e935df38c14adb2b6"
mkdir -p "$OUT"
# ZAP เขียน zap.yaml ทับไฟล์ของชุดเดิมใน results เก็บสำรองไว้แล้วคืนหลังสแกน
[ -f "$OUT/zap.yaml" ] && cp "$OUT/zap.yaml" "$HERE/.zap.yaml.bak"

for RUN in 1 2; do
  NAME="v4-kpi4-round${ROUND}-zap-run${RUN}"
  echo "== ZAP baseline run ${RUN} -> ${NAME}"
  # zap-baseline.py คืนค่าไม่เป็น 0 เมื่อมีคำเตือน จึงไม่ให้หยุดสคริปต์
  MSYS_NO_PATHCONV=1 docker run --rm -v "$OUT:/zap/wrk:rw" "$IMAGE" \
    zap-baseline.py -t "$URL" -J "${NAME}.json" -r "${NAME}.html" > "$OUT/${NAME}.txt" 2>&1 || true
  tail -n 3 "$OUT/${NAME}.txt"
  node -e "const j=require(process.argv[1]);const c={};for(const s of j.site)for(const a of s.alerts){const r=a.riskdesc.split(' ')[0];c[r]=(c[r]||0)+1}console.log('alerts by risk:',JSON.stringify(c))" "$OUT/${NAME}.json"
done
mv "$OUT/zap.yaml" "$OUT/v4-kpi4-round${ROUND}-zap.yaml"
[ -f "$HERE/.zap.yaml.bak" ] && mv "$HERE/.zap.yaml.bak" "$OUT/zap.yaml"

for RUN in 1 2; do
  NAME="v4-kpi4-round${ROUND}-npm-audit-run${RUN}.json"
  echo "== npm audit run ${RUN} -> ${NAME}"
  (cd "$ROOT" && npm audit --omit=dev --json > "$OUT/$NAME" || true)
  node -e "const j=require(process.argv[1]);console.log('vulnerabilities:',JSON.stringify(j.metadata.vulnerabilities))" "$OUT/$NAME"
done
