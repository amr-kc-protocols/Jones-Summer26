#!/bin/sh
# Checks a live Supabase project from a machine with network access.
#   sh calendar/supabase/verify.sh
#
# Reads the same values the app uses, so it tests what the app will do.

U=$(sed -n "s/.*SUPABASE_URL *= *'\([^']*\)'.*/\1/p" "$(dirname "$0")/../config.js")
K=$(sed -n "s/.*SUPABASE_ANON_KEY *= *'\([^']*\)'.*/\1/p" "$(dirname "$0")/../config.js")
S=$(sed -n "s/.*SUPABASE_SCHEMA *= *'\([^']*\)'.*/\1/p" "$(dirname "$0")/../config.js")

echo "project : $U"
echo "schema  : $S"
echo

body=$(curl -s -w '\n%{http_code}' "$U/rest/v1/people?select=id&limit=1" \
  -H "apikey: $K" -H "Authorization: Bearer $K" -H "Accept-Profile: $S")
code=$(printf '%s' "$body" | tail -n1)
text=$(printf '%s' "$body" | sed '$d')

echo "HTTP $code"
echo "$text"
echo

case "$text$code" in
  *42501*|*"permission denied"*)
    echo "PASS — schema is exposed, and an anonymous request is refused."
    echo "       That is exactly right: the key alone opens nothing." ;;
  *PGRST106*|*"schema must be one of"*)
    echo "FAIL — the '$S' schema is not exposed to the API."
    echo "       Fix: Project Settings -> API -> Exposed schemas -> add '$S'." ;;
  *"Invalid API key"*|*401*)
    echo "FAIL — the key was rejected. Re-copy the anon / publishable key." ;;
  *200*)
    echo "FAIL — anonymous read succeeded. It should not."
    echo "       Re-run schema.sql; the grants or policies did not apply." ;;
  *000*)
    echo "FAIL — could not reach the host at all. Check the URL and your network." ;;
  *)
    echo "Unrecognised response - paste the above back to me." ;;
esac
