import subprocess, json
segs = ["intro","title","ov"] + [x for n in range(1,7) for x in (f"d{n}", f"s{n}")] + ["links","lineage","gaps","end"]
dur = {s: float(subprocess.check_output(["ffprobe","-v","error","-show_entries","format=duration","-of","csv=p=0",f"seg/{s}.mp4"])) for s in segs}
X = 0.5
cmd = ["ffmpeg","-y","-v","error"]
for s in segs: cmd += ["-i", f"seg/{s}.mp4"]
f, prev, off, start = [], "[0:v]", 0.0, {segs[0]: 0.0}
for i, s in enumerate(segs[1:], 1):
    off += dur[segs[i-1]] - X
    start[s] = off
    kind = "fade" if s.startswith("s") and s[1:].isdigit() else "fadeblack"
    out = f"[v{i}]"
    f.append(f"{prev}[{i}:v]xfade=transition={kind}:duration={X}:offset={off:.3f}{out}")
    prev = out
total = off + dur[segs[-1]]
# music: A = Inspired (opening → mission), B = Digital Lemonade (dashboard demo), C = Crossing the Chasm (gaps → end)
a_end = start["ov"] + 1.5; c_start = start["gaps"] - 1.0
M = "music/"
n = len(segs)
cmd += ["-i", M+"Inspired.mp3", "-i", M+"Digital Lemonade.mp3", "-i", M+"Crossing the Chasm.mp3"]
f.append(f"[{n}:a]atrim=0:{a_end+1:.2f},asetpts=PTS-STARTPTS,afade=t=in:d=2.5,afade=t=out:st={a_end-1:.2f}:d=2,volume=0.9[a]")
f.append(f"[{n+1}:a]atrim=0:{c_start-a_end+4:.2f},asetpts=PTS-STARTPTS,afade=t=in:d=2,afade=t=out:st={c_start-a_end+1:.2f}:d=2.5,adelay={int((a_end-1)*1000)}|{int((a_end-1)*1000)}[b]")
f.append(f"[{n+2}:a]atrim=0:{total-c_start+1:.2f},asetpts=PTS-STARTPTS,afade=t=in:d=2,afade=t=out:st={total-c_start-4:.2f}:d=4,adelay={int(c_start*1000)}|{int(c_start*1000)}[c]")
f.append(f"[a][b][c]amix=inputs=3:normalize=0,atrim=0:{total:.3f},loudnorm=I=-16:TP=-1.5:LRA=11[aout]")
f.append(f"{prev}drawtext=fontfile=/System/Library/Fonts/Helvetica.ttc:text='Threads @yz.zac':fontsize=24:fontcolor=white@0.85:box=1:boxcolor=black@0.45:boxborderw=10:x=w-tw-34:y=h-th-50[wm]")
prev = "[wm]"
cmd += ["-filter_complex", ";".join(f), "-map", prev, "-map", "[aout]", "-c:v","libx264","-crf","18","-preset","slow","-pix_fmt","yuv420p","-movflags","+faststart","-c:a","aac","-b:a","192k","-ar","48000","taipei_gogo_promo.mp4"]
subprocess.run(cmd, check=True)
print("total", round(total,1), "starts", {k: round(v,1) for k, v in start.items()}, "A→B", round(a_end,1), "B→C", round(c_start,1))
