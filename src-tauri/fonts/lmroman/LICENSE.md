# Latin Modern Roman — bundled for document export

These four faces (WOFF2, converted from the upstream OpenType with
`woff2_compress`) are embedded in the Compose binary and inlined into exported
PDF/HTML so documents render in Latin Modern Roman — the actively-maintained
Computer Modern successor used by modern LaTeX — on any machine:

- `LMRoman10-Regular.woff2`    — Latin Modern Roman, Regular (weight 400)
- `LMRoman10-Bold.woff2`       — Latin Modern Roman, Bold (weight 700)
- `LMRoman10-Italic.woff2`     — Latin Modern Roman, Italic
- `LMRoman10-BoldItalic.woff2` — Latin Modern Roman, Bold Italic

The 10pt optical design (`lmroman10`) is the master LaTeX sets `\normalsize`
body text in, so it matches the default `article` appearance.

## Origin

Latin Modern is produced by the GUST e-Foundry (the Polish TeX Users Group) from
Donald E. Knuth's Computer Modern via MetaType1, and is distributed natively as
PostScript Type 1 and OpenType/CFF. Source: <https://www.gust.org.pl/projects/e-foundry/latin-modern>.
Bundled version: 2.006. The WOFF2 here is a lossless re-packaging of the upstream
OpenType (the CFF outlines are preserved unchanged); only the container changed.

## License

Latin Modern is distributed under the GUST Font License (GFL) version 1.0, which
is legally equivalent to the LaTeX Project Public License (LPPL) 1.3c or later.
The full GFL text:

    % This is version 1.0, dated 22 June 2009, of the GUST Font License.
    % (GUST is the Polish TeX Users Group, https://www.gust.org.pl)
    %
    % For the most recent version of this license see
    % https://www.gust.org.pl/fonts/licenses/GUST-FONT-LICENSE.txt
    % or
    % https://tug.org/fonts/licenses/GUST-FONT-LICENSE.txt
    %
    % This work may be distributed and/or modified under the conditions
    % of the LaTeX Project Public License, either version 1.3c of this
    % license or (at your option) any later version.
    %
    % Please also observe the following clause:
    % 1) it is requested, but not legally required, that derived works be
    %    distributed only after changing the names of the fonts comprising this
    %    work and given in an accompanying "manifest", and that the
    %    files comprising the Work, as listed in the manifest, also be given
    %    new names. Any exceptions to this request are also given in the
    %    manifest.
    %
    %    We recommend the manifest be given in a separate file named
    %    MANIFEST-<fontid>.txt, where <fontid> is some unique identification
    %    of the font family. If a separate "readme" file accompanies the Work,
    %    we recommend a name of the form README-<fontid>.txt.
    %
    % The latest version of the LaTeX Project Public License is in
    % https://www.latex-project.org/lppl.txt and version 1.3c or later
    % is part of all distributions of LaTeX version 2006/05/20 or later.

The GFL's only substantive request is that *modified* fonts be renamed. The
glyph data here is unmodified (lossless container change only) and the internal
font names are unchanged, so bundling and embedding these faces in an
application binary and in exported documents is unrestricted.
