#!/usr/bin/env bash
# Relance PaieCam dans le Codespace, attend qu'il réponde et affiche l'adresse ou l'erreur.
cd "$(dirname "$0")/.."
echo "Arrêt de l'ancien serveur…"
# « next dev » lance un processus enfant « next-server » qui garde le port 3000 : on arrête les deux.
pkill -f "next dev|next-server|next/dist" 2>/dev/null; pkill -f "src/worker.ts" 2>/dev/null
for i in $(seq 1 15); do
  pgrep -f "next dev|next-server|next/dist" > /dev/null || break
  sleep 1
done
pkill -9 -f "next dev|next-server|next/dist" 2>/dev/null; sleep 1
diagnostic() {
  tail -n 40 .data/journaux/web.log
  echo "Processus en cours :"
  ps -eo pid,etime,pcpu,rss,args | grep -E "next|node" | grep -v grep | cut -c1-160
  echo "Mémoire :"; free -m | head -2
  exit 1
}
bash .devcontainer/start.sh
url=$(grep '^APP_URL=' .env | cut -d= -f2-)
echo "Compilation de la première page (jusqu'à 5 minutes la première fois)…"
for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 http://localhost:3000/connexion)
  if [ "$code" = "200" ]; then
    echo; echo "PaieCam est prêt. Ouvrez dans un onglet du navigateur : ${url}/connexion"
    exit 0
  fi
  if grep -q "EADDRINUSE" .data/journaux/web.log || ! pgrep -f "next dev" > /dev/null; then
    echo; echo "Le serveur s'est arrêté. Dernières lignes du journal :"
    diagnostic
  fi
  printf "."
  sleep 5
done
echo; echo "Toujours pas de réponse (code ${code}). Dernières lignes du journal :"
diagnostic
