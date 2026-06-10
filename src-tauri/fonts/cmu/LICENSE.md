# CMU Serif (Computer Modern Unicode) — bundled for document export

These four faces (WOFF2, converted from the upstream TrueType with
`woff2_compress`) are embedded in the Compose binary and inlined into exported
PDF/HTML so documents render in Computer Modern, the classic TeX/LaTeX serif, on
any machine:

- `CMU-Serif-Roman.woff2`      — CMU Serif, Roman (weight 400)
- `CMU-Serif-Bold.woff2`       — CMU Serif, Bold (weight 700)
- `CMU-Serif-Italic.woff2`     — CMU Serif, Italic
- `CMU-Serif-BoldItalic.woff2` — CMU Serif, Bold Italic

## Origin

Computer Modern Unicode fonts were converted by Andrey V. Panov from the
metafont sources of Donald E. Knuth's Computer Modern. Upstream project:
<https://cm-unicode.sourceforge.io/>.

## License

The Computer Modern Unicode fonts are distributed under the same permissive,
Knuth-style terms as Computer Modern itself: they may be freely used, copied,
modified, and redistributed, provided that modified versions are renamed so they
are not confused with the originals. The glyph data here is unmodified: only the
container changed (TTF → WOFF2, a lossless re-packaging) and the file names; the
internal font names are unchanged.

Full upstream license text accompanies the cm-unicode distribution at the URL
above. No restriction there conflicts with bundling the faces in an application
binary or embedding them in exported documents.
