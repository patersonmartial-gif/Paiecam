#!/usr/bin/env bash
# Relance PaieCam dans le Codespace, attend qu'il réponde et affiche l'adresse ou l'erreur.
cd "$(dirname "$0")/.."
echo "Arrêt de l'ancien serveur…"
pkill -f "next dev" 2>/dev/null; pkill -f "src/worker.ts" 2>/dev/null; sleep 2
bash .devcontainer/start.sh
url=$(grep '^APP_URL=' .env | cut -d= -f2-)
echo "Compilation de la première page (jusqu'à 5 minutes la première fois)…"
for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 http://localhost:3000/connexion)
  if [ "$code" = "200" ]; then
    echo; echo "PaieCam est prêt. Ouvrez dans un onglet du navigateur : ${url}/connexion"
    exit 0
  fi
  if ! pgrep -f "next dev" > /dev/null; then
    echo; echo "Le serveur s'est arrêté. Dernières lignes du journal :"
    tail -n 40 .data/journaux/web.log; exit 1
  fi
  printf "."
  sleep 5
done
echo; echo "Toujours pas de réponse (code ${code}). Dernières lignes du journal :"
tail -n 40 .data/journaux/web.log; exit 1
