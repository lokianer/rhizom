// The bubble field, brought to life.
//
// The drawing in the HTML is the fallback: without this file it is a still illustration, which
// is what it was. With it, the same circles and lines become a small force simulation — springs
// along the links, a little repulsion between the notes, and a soft pull back to where each one
// was drawn, so the composition never wanders off. Notes can be dragged; the field follows.
//
// No library: thirty-odd nodes need about sixty lines of arithmetic, and a landing page for a
// tool that phones nobody should not fetch a physics engine from a CDN.
(function () {
  var svg = document.querySelector('.field svg');
  if (!svg || !svg.getScreenCTM) {
    return;
  }

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* The drawing, read back out of the DOM. */

  var nodes = Array.prototype.map.call(svg.querySelectorAll('circle'), function (el) {
    var x = Number(el.getAttribute('cx'));
    var y = Number(el.getAttribute('cy'));
    return { el: el, x: x, y: y, hx: x, hy: y, vx: 0, vy: 0, r: Number(el.getAttribute('r')) };
  });
  if (nodes.length === 0) {
    return;
  }

  function nearest(x, y) {
    var best = nodes[0];
    var bestDistance = Infinity;
    nodes.forEach(function (node) {
      var distance = (node.hx - x) * (node.hx - x) + (node.hy - y) * (node.hy - y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = node;
      }
    });
    return best;
  }

  var links = Array.prototype.map.call(svg.querySelectorAll('line'), function (el) {
    var a = nearest(Number(el.getAttribute('x1')), Number(el.getAttribute('y1')));
    var b = nearest(Number(el.getAttribute('x2')), Number(el.getAttribute('y2')));
    return { el: el, a: a, b: b, rest: Math.hypot(a.hx - b.hx, a.hy - b.hy) };
  });

  /* Forces. The numbers are small on purpose: this is a field settling, not a toy bouncing. */

  var SPRING = 0.02;
  var HOME = 0.006;
  var REPEL = 140;
  var DAMPING = 0.86;
  var dragged = null;
  var clock = 0;

  function tick() {
    clock += 1;
    // Where each note would like to be: its place in the drawing, breathing a little.
    nodes.forEach(function (node, index) {
      var wander = reduced ? 0 : 1;
      var tx = node.hx + Math.sin(clock / 220 + index) * 2.5 * wander;
      var ty = node.hy + Math.cos(clock / 260 + index * 1.7) * 2.5 * wander;
      node.vx += (tx - node.x) * HOME;
      node.vy += (ty - node.y) * HOME;
    });

    links.forEach(function (link) {
      var dx = link.b.x - link.a.x;
      var dy = link.b.y - link.a.y;
      var distance = Math.hypot(dx, dy) || 0.001;
      var force = ((distance - link.rest) * SPRING) / distance;
      link.a.vx += dx * force;
      link.a.vy += dy * force;
      link.b.vx -= dx * force;
      link.b.vy -= dy * force;
    });

    for (var i = 0; i < nodes.length; i += 1) {
      for (var j = i + 1; j < nodes.length; j += 1) {
        var a = nodes[i];
        var b = nodes[j];
        var dx2 = b.x - a.x;
        var dy2 = b.y - a.y;
        var d2 = dx2 * dx2 + dy2 * dy2 || 0.001;
        var reach = (a.r + b.r + REPEL) * (a.r + b.r + REPEL);
        if (d2 < reach) {
          var push = (REPEL * 6) / d2;
          var distance2 = Math.sqrt(d2);
          a.vx -= (dx2 / distance2) * push;
          a.vy -= (dy2 / distance2) * push;
          b.vx += (dx2 / distance2) * push;
          b.vy += (dy2 / distance2) * push;
        }
      }
    }

    nodes.forEach(function (node) {
      if (node === dragged) {
        node.vx = 0;
        node.vy = 0;
        return;
      }
      node.vx *= DAMPING;
      node.vy *= DAMPING;
      node.x += node.vx;
      node.y += node.vy;
    });

    draw();
  }

  function draw() {
    nodes.forEach(function (node) {
      node.el.setAttribute('cx', node.x.toFixed(2));
      node.el.setAttribute('cy', node.y.toFixed(2));
    });
    links.forEach(function (link) {
      link.el.setAttribute('x1', link.a.x.toFixed(2));
      link.el.setAttribute('y1', link.a.y.toFixed(2));
      link.el.setAttribute('x2', link.b.x.toFixed(2));
      link.el.setAttribute('y2', link.b.y.toFixed(2));
    });
  }

  /* Dragging. The point has to be converted into the drawing's own coordinates, which is what
     the screen matrix is for — the field is cropped to a band, so the two do not line up. */

  function at(event) {
    var matrix = svg.getScreenCTM();
    if (!matrix) {
      return null;
    }
    var point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    return point.matrixTransform(matrix.inverse());
  }

  function hit(point) {
    var found = null;
    nodes.forEach(function (node) {
      var distance = Math.hypot(node.x - point.x, node.y - point.y);
      if (distance < node.r + 10 && (found === null || distance < found.distance)) {
        found = { node: node, distance: distance };
      }
    });
    return found && found.node;
  }

  svg.addEventListener('pointerdown', function (event) {
    var point = at(event);
    var node = point && hit(point);
    if (!node) {
      return;
    }
    dragged = node;
    svg.classList.add('is-dragging');
    svg.setPointerCapture(event.pointerId);
    // Only once a note is actually held: otherwise a touch here could not scroll the page.
    svg.style.touchAction = 'none';
    event.preventDefault();
    wake();
  });

  svg.addEventListener('pointermove', function (event) {
    if (!dragged) {
      var point = at(event);
      svg.classList.toggle('is-over', Boolean(point && hit(point)));
      return;
    }
    var held = at(event);
    if (held) {
      dragged.x = held.x;
      dragged.y = held.y;
      draw();
    }
  });

  function release(event) {
    if (!dragged) {
      return;
    }
    dragged = null;
    svg.classList.remove('is-dragging');
    svg.style.touchAction = '';
    if (event && event.pointerId !== undefined && svg.hasPointerCapture(event.pointerId)) {
      svg.releasePointerCapture(event.pointerId);
    }
    wake();
  }

  svg.addEventListener('pointerup', release);
  svg.addEventListener('pointercancel', release);
  svg.addEventListener('pointerleave', function () {
    svg.classList.remove('is-over');
  });

  /* The loop runs while the field is on screen, and — with reduced motion — only while it is
     being pushed around, because then nothing moves unless somebody moves it. */

  var frame = null;
  var quiet = 0;
  var visible = true;

  function loop() {
    tick();
    if (reduced) {
      var energy = nodes.reduce(function (total, node) {
        return total + Math.abs(node.vx) + Math.abs(node.vy);
      }, 0);
      quiet = dragged || energy > 0.4 ? 0 : quiet + 1;
      if (quiet > 30) {
        frame = null;
        return;
      }
    }
    frame = requestAnimationFrame(loop);
  }

  function wake() {
    if (frame === null && visible) {
      frame = requestAnimationFrame(loop);
    }
  }

  function sleep() {
    if (frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
    }
  }

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      visible = entries[0].isIntersecting;
      if (visible && !reduced) {
        wake();
      } else if (!visible) {
        sleep();
      }
    }).observe(svg);
  }

  if (!reduced) {
    wake();
  }
})();
