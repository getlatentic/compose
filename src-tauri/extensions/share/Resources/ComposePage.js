// Safari runs this inside the page being shared, before the Share sheet opens.
// What `completionFunction` receives reaches the extension under
// NSExtensionJavaScriptPreprocessingResultsKey. Everything but the one global
// Safari looks for stays in this closure: the script shares the page's scope.
var ExtensionPreprocessingJS = (function () {
  // Past this, a page is almost certainly carrying data rather than an article.
  var MAX_PAGE_LENGTH = 8 * 1024 * 1024;

  function absolute(root) {
    var linked = root.querySelectorAll("[href], [src]");
    for (var i = 0; i < linked.length; i++) {
      var node = linked[i];
      ["href", "src"].forEach(function (attribute) {
        var value = node.getAttribute(attribute);
        if (value === null) return;
        try {
          node.setAttribute(attribute, new URL(value, document.baseURI).href);
        } catch (error) {
          // Not a URL (a template placeholder, say): left as written.
        }
      });
    }
    return root;
  }

  /** What the user selected, as HTML, with its links made absolute. */
  function selectionHTML() {
    var selection = window.getSelection();
    if (!selection || selection.isCollapsed) return "";
    var container = document.createElement("div");
    for (var i = 0; i < selection.rangeCount; i++) {
      container.appendChild(selection.getRangeAt(i).cloneContents());
    }
    return absolute(container).innerHTML;
  }

  /** The page without what can never be article text. Compose picks the article out. */
  function pageHTML() {
    var copy = document.documentElement.cloneNode(true);
    var noise = copy.querySelectorAll("script, style, noscript, template, iframe");
    for (var i = 0; i < noise.length; i++) {
      noise[i].parentNode.removeChild(noise[i]);
    }
    var html = copy.outerHTML;
    return html.length <= MAX_PAGE_LENGTH ? html : "";
  }

  return {
    run: function (parameters) {
      var selection = selectionHTML();
      parameters.completionFunction({
        url: document.URL,
        title: document.title,
        selection: selection,
        page: selection ? "" : pageHTML(),
      });
    },
  };
})();
