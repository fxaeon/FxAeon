import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
const root = import.meta.dirname;
const asset = name => resolve(root, '../assets', name);
const encode = (source, filter, quality, output) => execFileSync('ffmpeg', [
  '-hide_banner', '-loglevel', 'error', '-y', '-i', resolve(root, source),
  '-vf', filter, '-c:v', 'libx264', '-crf', String(quality), '-preset', 'slow',
  '-pix_fmt', 'yuv420p', '-color_primaries', 'bt709', '-color_trc', 'iec61966-2-1',
  '-colorspace', 'bt709', '-an', '-movflags', '+faststart', asset(output),
], { stdio: 'inherit' });
// Browser compositing needs the sRGB transfer tag to match the page's cobalt.
encode('current-wide.mp4', 'scale=in_color_matrix=bt709:out_color_matrix=bt709', 20, 'brand-film.mp4');
encode('current-master.mp4', 'scale=540:540:in_color_matrix=bt709:out_color_matrix=bt709', 23, 'brand-film-mobile.mp4');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', resolve(root, 'current-wide.mp4'),
  '-frames:v', '1', '-q:v', '3', asset('brand-film-poster.jpg')], { stdio: 'inherit' });
