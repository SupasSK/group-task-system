#!/usr/bin/env bash
# KPI-10 รอบที่ <round>: k6 3 ครั้งห่างกันอย่างน้อย 30 นาที แล้วตามด้วยรอบผู้ใช้คนเดียว (ตัวควบคุม)
# วิธีรัน: K6=<path to k6.exe> bash kpi10-load-runs.sh <round>
set -u
ROUND=$1
cd "$(dirname "$0")"
OUT=../docs/evaluation/results
SBU=$(grep NEXT_PUBLIC_SUPABASE_URL ../.env.local | cut -d= -f2-)
AK=$(grep NEXT_PUBLIC_SUPABASE_ANON_KEY ../.env.local | cut -d= -f2-)
PW=$(grep TEST_PASSWORD .env.test | cut -d= -f2-)
run() { # $1 = ชื่อไฟล์, ที่เหลือ = ตัวเลือก k6
  local name=$1; shift
  echo "$(date -u +%FT%TZ) start $name" >> "$OUT/kpi10-round$ROUND-load.log"
  "$K6" run "$@" -e PASSWORD="$PW" -e SUPABASE_URL="$SBU" -e ANON_KEY="$AK" --summary-export "$OUT/kpi10-round$ROUND-$name.json" kpi10-load.js > "$OUT/kpi10-round$ROUND-$name.txt" 2>&1
  echo "$(date -u +%FT%TZ) end $name exit=$?" >> "$OUT/kpi10-round$ROUND-load.log"
}
run load-run1
sleep 1800
run load-run2
sleep 1800
run load-run3
sleep 300
run control -e CONTROL=1
