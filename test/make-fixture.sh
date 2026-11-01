#!/usr/bin/env bash
# Builds a fake band-practice recording: talk / song / talk / song (with a
# short breakdown) / talk / song / talk. Expected: 3 songs at roughly
#   song 1: 25s - 95s, song 2: 115s - 210s, song 3: 225s - 275s
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p fixtures && cd fixtures

talk() { # name seconds text
  say -o "$1.aiff" "$3"
  ffmpeg -hide_banner -loglevel error -y -i "$1.aiff" \
    -f lavfi -t "$2" -i "anoisesrc=color=pink:amplitude=0.004:r=44100" \
    -filter_complex "[0:a]aresample=44100,aformat=channel_layouts=mono,volume=0.22,apad,atrim=0:$2[v];[v][1:a]amix=inputs=2:normalize=0,aformat=channel_layouts=stereo[out]" \
    -map "[out]" -ar 44100 "$1.wav"
}

song() { # name seconds root_hz
  local f=$3
  ffmpeg -hide_banner -loglevel error -y -f lavfi -t "$2" -i \
    "aevalsrc='0.22*sin(2*PI*$f*t)+0.16*sin(2*PI*$f*1.5*t)+0.12*sin(2*PI*$f*2*t)+0.10*sin(2*PI*$f*0.5*t)+0.35*(random(0)*2-1)*exp(-mod(t,0.5)*18)+0.25*sin(2*PI*55*t)*exp(-mod(t+0.25,0.5)*10)':s=44100" \
    -af "aformat=channel_layouts=stereo,volume=1.0" -ar 44100 "$1.wav"
}

breakdown() { # quiet 3s in the middle of a song (just a soft sustained note)
  ffmpeg -hide_banner -loglevel error -y -f lavfi -t "$1" -i "aevalsrc='0.03*sin(2*PI*220*t)':s=44100" \
    -af "aformat=channel_layouts=stereo" "$2.wav"
}

talk t1 25 "Okay, is everybody ready? Let's start with the new one. Can you turn the bass up a little? Alright, one, two, three, four."
song s1 70 110
talk t2 20 "That was pretty good. I think the bridge was a bit rushed. Let's try the other one now, the slow one."
song s2a 45 98
breakdown 3 b2
song s2b 47 98
talk t3 15 "Nice. Water break. Okay, last one for tonight, let's go."
song s3 50 131
talk t4 10 "Great practice everyone. See you next week."

printf "file '%s.wav'\n" t1 s1 t2 s2a b2 s2b t3 s3 t4 > list.txt
ffmpeg -hide_banner -loglevel error -y -f concat -safe 0 -i list.txt -c:a aac -b:a 160k practice.m4a
rm -f ./*.aiff t?.wav s*.wav b?.wav list.txt
echo "Wrote $(pwd)/practice.m4a"
ffprobe -v error -show_entries format=duration -of default=nw=1 practice.m4a
