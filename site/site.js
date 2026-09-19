// The landing page's four small enhancements. Every one of them is optional: without this file
// the page still reads, every screenshot is visible, and the theme is Humus.
(function () {
  var root = document.documentElement;

  /* Theme switch — remembers the choice; the inline script in <head> applies it before paint. */

  var KEY = 'rhizom-theme';
  var buttons = Array.prototype.slice.call(document.querySelectorAll('[data-set-theme]'));

  function showTheme(name) {
    buttons.forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.dataset.setTheme === name));
    });
  }

  function currentTheme() {
    try {
      return localStorage.getItem(KEY) || 'humus';
    } catch (error) {
      return 'humus';
    }
  }

  buttons.forEach(function (button) {
    button.addEventListener('click', function () {
      var name = button.dataset.setTheme;
      root.setAttribute('data-theme', name);
      showTheme(name);
      try {
        localStorage.setItem(KEY, name);
      } catch (error) {
        /* Storage unavailable; the choice lasts for this page only. */
      }
    });
  });
  showTheme(currentTheme());

  /* Header — a hairline once the page has moved under it. */

  var header = document.querySelector('.site-header');
  if (header) {
    var onScroll = function () {
      header.classList.toggle('is-scrolled', window.scrollY > 8);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* Screenshots — one tab panel at a time, with the arrow keys a tablist is expected to have. */

  var tabs = Array.prototype.slice.call(document.querySelectorAll('[role="tab"]'));

  function selectTab(tab, focus) {
    tabs.forEach(function (other) {
      var selected = other === tab;
      other.setAttribute('aria-selected', String(selected));
      other.tabIndex = selected ? 0 : -1;
      var panel = document.getElementById(other.getAttribute('aria-controls'));
      if (panel) {
        panel.hidden = !selected;
      }
    });
    if (focus) {
      tab.focus();
    }
  }

  tabs.forEach(function (tab, index) {
    tab.addEventListener('click', function () {
      selectTab(tab, false);
    });
    tab.addEventListener('keydown', function (event) {
      var step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (step !== 0) {
        event.preventDefault();
        selectTab(tabs[(index + step + tabs.length) % tabs.length], true);
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        selectTab(tabs[event.key === 'Home' ? 0 : tabs.length - 1], true);
      }
    });
  });

  /* The command, on the clipboard. */

  var copy = document.querySelector('[data-copy]');
  if (copy && navigator.clipboard) {
    copy.addEventListener('click', function () {
      var source = document.getElementById(copy.dataset.copy);
      if (!source) {
        return;
      }
      navigator.clipboard.writeText(source.textContent.trim()).then(
        function () {
          var was = copy.textContent;
          copy.textContent = 'Copied';
          setTimeout(function () {
            copy.textContent = was;
          }, 1600);
        },
        function () {
          /* Refused by the browser; the text is right there to select. */
        },
      );
    });
  } else if (copy) {
    copy.hidden = true;
  }

  /* Sections arrive as they are scrolled to. Without IntersectionObserver nothing is hidden. */

  var reveals = Array.prototype.slice.call(
    document.querySelectorAll('.section, .showcase .page, .run__inner, .status__row, .cta__inner'),
  );
  if (!('IntersectionObserver' in window)) {
    return;
  }
  var observer = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          observer.unobserve(entry.target);
        }
      });
    },
    { rootMargin: '0px 0px -10% 0px' },
  );
  reveals.forEach(function (element) {
    element.classList.add('reveal');
    observer.observe(element);
  });
})();
