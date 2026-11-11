(() => {
  'use strict';

  const data = window.NDVI_DATA;
  const {years, rows, cols, cellKm, units, cells} = data;
  const indexOf = year => year - years[0];
  const cellValue = (cell, index) => cell[4 + index] / units;
  const changeUnits = (cell, from, to) => cell[4 + to] - cell[4 + from];
  const fmt = d3.format('.3f');
  const detailFmt = d3.format('.4f');
  const deltaFormat = d3.format('+.4f');
  const signed = value => Math.abs(value) < .00005 ? '0.0000' : deltaFormat(value);
  const percent = d3.format('.1%');
  const commas = d3.format(',');
  const site = id => document.getElementById(id);
  const coord = c => `${c[2].toFixed(2)}° N, ${Math.abs(c[3]).toFixed(2)}° W`;

  const categories = [
    {name:'Less green', range:'< −0.02', color:'#a3532a'},
    {name:'Small change', range:'−0.02 to +0.02', color:'#d8dcd3'},
    {name:'Greener', range:'> +0.02', color:'#136c61'}
  ];
  const smallCutoff = units * .02;
  const levels = [
    {name:'Lowest', range:'< 0.15', color:'#f2efd3'},
    {name:'Low', range:'0.15 to < 0.30', color:'#c8d5a4'},
    {name:'Middle', range:'0.30 to < 0.45', color:'#90b376'},
    {name:'High', range:'0.45 to < 0.60', color:'#508456'},
    {name:'Highest', range:'≥ 0.60', color:'#214f3b'}
  ];
  const level = d3.scaleThreshold().domain([.15, .30, .45, .60].map(x => x * units))
    .range(d3.range(levels.length));
  const cases = {
    '2021-2023':'2021 fell during a severe statewide drought. A wet 2023 brought statewide drought relief.',
    '2014-2017':'2014 was the driest year of the 2012–2016 drought. A wet 2017 brought statewide relief, though some counties still had drought impacts.'
  };
  function classify(delta) {
    return delta < -smallCutoff ? 0 : delta > smallCutoff ? 2 : 1;
  }

  // Cell indexing preserves the shape and north-up orientation of the GeoTIFFs.
  const W = 222, H = 226, left = 18, top = 6;
  const grid = Array(rows * cols);
  const tile = c => `M${c[1] + left},${c[0] + top}h1v1h-1z`;
  const geometry = cells.map(c => {
    grid[c[0] * cols + c[1]] = c;
    return tile(c);
  });
  function at(row, col) {
    if (row >= 0 && row < rows && col >= 0 && col < cols) return grid[row * cols + col];
  }
  const stateSeries = years.map((year, i) => ({year, value:d3.mean(cells, c => cellValue(c, i))}));
  const state = {from:2021, to:2023, mode:'year', year:2021, selected:null, transform:d3.zoomIdentity};

  const map = d3.select('#map').attr('aria-describedby', 'map-instructions keyboard-help');
  const mapNode = map.node();
  const viewportLayer = map.append('g').attr('class', 'map-viewport').attr('aria-hidden', 'true');
  const viewport = map.append('g').attr('aria-hidden', 'true').attr('pointer-events', 'none');
  const focusCell = viewport.append('rect').attr('width', 1).attr('height', 1)
    .attr('stroke', '#18342c').attr('stroke-width', 2).attr('stroke-linejoin', 'round')
    .attr('vector-effect', 'non-scaling-stroke').attr('fill', 'none').attr('visibility', 'hidden');
  const pin = map.append('circle').attr('r', 2.8).attr('fill', '#fffefa')
    .attr('stroke', '#18342c').attr('stroke-width', 1)
    .attr('pointer-events', 'none').attr('aria-hidden', 'true').attr('visibility', 'hidden');

  function drawPin() {
    const c = state.selected;
    if (!c) {
      focusCell.attr('visibility', 'hidden');
      pin.attr('visibility', 'hidden');
      return;
    }
    focusCell.attr('visibility', null).attr('x', c[1] + left).attr('y', c[0] + top);
    const [x, y] = state.transform.apply([c[1] + left + .5, c[0] + top + .5]);
    pin.attr('visibility', state.transform.k >= 4 ? 'hidden' : null).attr('cx', x).attr('cy', y);
  }

  function drawScale() {
    const screenScale = map.node().getScreenCTM()?.a ?? 1;
    const k = screenScale * state.transform.k;
    const km = [10, 20, 50, 100, 200].reduce((best, candidate) =>
      Math.abs(candidate / cellKm * k - 52) < Math.abs(best / cellKm * k - 52) ? candidate : best);
    site('scale-line').style.width = `${km / cellKm * k}px`;
    site('scale-label').textContent = `${km} km`;
  }

  function hideTooltip() {
    site('map-tooltip').hidden = true;
  }
  const zoom = d3.zoom().extent([[0, 0], [W, H]])
    .scaleExtent([1, 10]).translateExtent([[-14, -12], [W + 14, H + 12]])
    .clickDistance(4)
    .filter(event => event.type === 'wheel'
      ? event.ctrlKey || event.metaKey
      : !event.ctrlKey && !event.button)
    .on('zoom', ({transform}) => {
      state.transform = transform;
      viewportLayer.attr('transform', transform);
      viewport.attr('transform', transform);
      drawPin();
      drawScale();
      hideTooltip();
      updateZoomButtons();
    });
  map.call(zoom).on('dblclick.zoom', null);

  function updateZoomButtons() {
    const {k, x, y} = state.transform;
    site('zoom-in').disabled = k >= 9.999;
    site('zoom-out').disabled = k <= 1.001;
    site('reset').disabled = k === 1 && x === 0 && y === 0;
  }
  function scaleBy(factor) {
    map.call(zoom.scaleBy, factor, [W / 2, H / 2]);
  }
  function reset() {
    map.call(zoom.transform, d3.zoomIdentity);
  }
  site('zoom-in').addEventListener('click', () => scaleBy(1.55));
  site('zoom-out').addEventListener('click', () => scaleBy(1 / 1.55));
  site('reset').addEventListener('click', reset);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(drawScale).observe(mapNode);

  function cellFromPointer(event) {
    const [x, y] = state.transform.invert(d3.pointer(event, map.node()));
    return at(Math.floor(y - top), Math.floor(x - left));
  }
  const tip = site('map-tooltip');
  map.on('pointermove.inspect', event => {
    const cell = event.buttons ? null : cellFromPointer(event);
    if (!cell || event.pointerType === 'touch') return hideTooltip();
    const [x, y] = d3.pointer(event, site('map-frame'));
    tip.replaceChildren();
    const value = document.createElement('strong');
    if (state.mode === 'change') {
      const delta = changeUnits(cell, indexOf(state.from), indexOf(state.to));
      value.textContent = `${signed(delta / units)} NDVI · ${categories[classify(delta)].name}`;
    } else {
      const year = state.year;
      value.textContent = `${year} · NDVI ${detailFmt(cellValue(cell, indexOf(year)))}`;
    }
    tip.append(value, coord(cell), document.createElement('br'), 'Click to see this cell’s history');
    tip.hidden = false;
    tip.style.left = `${Math.max(4, Math.min(x + 14, site('map-frame').clientWidth - tip.offsetWidth - 5))}px`;
    tip.style.top = `${Math.max(4, Math.min(y + 12, site('map-frame').clientHeight - tip.offsetHeight - 5))}px`;
  }).on('pointerleave.inspect', hideTooltip)
    .on('click.select', event => {
      const cell = cellFromPointer(event);
      if (cell) selectCell(cell);
    });

  const arrowSteps = {ArrowLeft:[0,-1], ArrowRight:[0,1], ArrowUp:[-1,0], ArrowDown:[1,0]};
  map.on('keydown.inspect', event => {
    const step = arrowSteps[event.key];
    if (step) {
      event.preventDefault();
      if (event.shiftKey) {
        map.call(zoom.translateBy, -step[1] * 14 / state.transform.k, -step[0] * 14 / state.transform.k);
        return;
      }
      let next;
      if (state.selected) {
        const [row, col] = state.selected;
        for (let i = 1; i <= Math.max(rows, cols); i++) {
          next = at(row + step[0] * i, col + step[1] * i);
          if (next) break;
        }
      } else {
        const [x, y] = state.transform.invert([W / 2, H / 2]);
        next = d3.least(cells, c => (c[1] + left - x)**2 + (c[0] + top - y)**2);
      }
      if (next) {
        selectCell(next);
        const [x, y] = state.transform.apply([next[1] + left + .5, next[0] + top + .5]);
        if (x < 5 || x > W - 5 || y < 5 || y > H - 5) {
          map.call(zoom.translateTo, next[1] + left + .5, next[0] + top + .5);
        }
      }
    } else if (['+', '=', '-', '−', 'Escape'].includes(event.key)) {
      event.preventDefault();
      if (event.key === 'Escape') selectCell(null);
      else scaleBy(event.key === '+' || event.key === '=' ? 1.55 : 1 / 1.55);
    }
  });

  function selectCell(cell) {
    state.selected = cell;
    drawPin();
    drawTrend();
  }

  const reference = d3.select('#reference');
  reference.selectAll('option').data(years).join('option').attr('value', y => y).text(y => y);
  reference.on('change', event => update(+event.target.value, state.to));
  const slider = d3.select('#year').on('input', event => update(state.from, +event.target.value));
  const timeline = d3.select('#map-year').on('input', event => setYear(+event.target.value));
  d3.selectAll('.preset').on('click', function() {
    update(+this.dataset.ref, +this.dataset.year);
  });
  const modeButtons = d3.selectAll('.mode').on('click', function() {
    state.mode = this.dataset.mode;
    drawMap();
    drawTrend();
    hideTooltip();
  });
  site('clear').addEventListener('click', () => {
    selectCell(null);
    map.node().focus({preventScroll:true});
  });

  function update(from, to) {
    state.from = from;
    state.to = to;
    state.year = from;
    state.mode = 'year';
    const context = cases[`${from}-${to}`];
    reference.property('value', from);
    slider.property('value', to).attr('aria-valuetext', `${to}, compared with ${from}`);
    site('year-output').value = to;
    site('case-context').textContent = context ||
      `Custom comparison: ${from} and ${to}. These years are shown without drought labels.`;
    d3.selectAll('.preset').attr('aria-pressed', function() {
      return +this.dataset.ref === from && +this.dataset.year === to;
    });
    drawMap();
    drawSummary();
    drawTrend();
    hideTooltip();
  }

  function setYear(year) {
    state.year = year;
    drawMap();
    drawTrend();
    hideTooltip();
  }

  function yearRole(year) {
    const {from, to} = state;
    const featured = Boolean(cases[`${from}-${to}`]);
    if (from === to) return '';
    if (year === from) return featured ? 'Drought year' : 'Reference year';
    if (year === to) return featured ? 'Wetter year' : 'Comparison year';
    return '';
  }

  function drawTimeline() {
    const {from, to, year} = state;
    const lo = Math.min(from, to), hi = Math.max(from, to);
    const role = yearRole(year);
    const label = role ? `${year} · ${role}` : String(year);
    site('map-year-output').value = label;
    timeline.attr('min', lo).attr('max', hi).property('value', year)
      .property('disabled', lo === hi).attr('aria-valuetext', label);
    const tickYears = hi - lo <= 4 ? d3.range(lo, hi + 1) : [lo, hi];
    const stops = d3.select('#timeline-years').selectAll('button').data(tickYears, y => y).join(enter => {
      const button = enter.append('button').attr('type', 'button').attr('class', 'timeline-year');
      button.append('strong');
      button.append('span');
      return button;
    }).style('left', y => `${hi === lo ? 0 : (y-lo)/(hi-lo)*100}%`)
      .attr('aria-pressed', y => y === year).on('click', (_, y) => setYear(y));
    stops.select('strong').text(y => y);
    stops.select('span').text(yearRole);
  }

  function drawMap() {
    const {from, to, mode, year} = state;
    const annual = mode === 'year';
    const a = indexOf(from), b = indexOf(to), i = indexOf(year);
    modeButtons.attr('aria-pressed', function() { return this.dataset.mode === mode; });
    modeButtons.filter('[data-mode="change"]').text(`Show change: ${to} − ${from}`);
    site('map-title').textContent = annual ? `Greenness in ${year}`
      : `Where greenness changed · ${from} to ${to}`;
    site('map-svg-title').textContent = annual
      ? `California seasonal greenness in ${year}`
      : `California seasonal NDVI change: ${to} minus ${from}`;
    site('legend-title').textContent = annual ? 'Greenness (NDVI) · fixed scale' : `Change in NDVI · ${to} minus ${from}`;
    site('timeline').hidden = !annual;
    site('change-explanation').hidden = annual;
    site('change-explanation').textContent = `Full-period change: ${to} greenness minus ${from} greenness.`;
    if (annual) drawTimeline();
    const palette = annual ? levels : categories;
    const paths = palette.map(() => []);
    for (let n = 0; n < cells.length; n++) {
      const c = cells[n];
      paths[annual ? level(c[4 + i]) : classify(changeUnits(c, a, b))].push(geometry[n]);
    }
    viewportLayer.selectAll('path.band').data(palette).join('path').attr('class', 'band')
      .attr('fill', d => d.color).attr('d', (_, n) => paths[n].join(''));
    d3.select('#legend-classes').classed('is-change', !annual);
    drawLegend('#legend-classes', palette);
  }
  function drawLegend(selector, palette) {
    const legend = d3.select(selector).selectAll('div').data(palette).join(enter => {
      const item = enter.append('div').attr('class', 'legend-item');
      item.append('i').attr('aria-hidden', 'true');
      item.append('strong');
      item.append('span');
      return item;
    });
    legend.select('i').style('background-color', d => d.color);
    legend.select('strong').text(d => d.name);
    legend.select('span').text(d => d.range);
  }

  function drawSummary() {
    const {from, to} = state;
    const i = indexOf(from), j = indexOf(to);
    const a = stateSeries[i].value, b = stateSeries[j].value;
    const mean = d3.select('#mean-change').text(`Mean NDVI · ${from} to ${to}: `);
    mean.append('strong').text(`${fmt(a)} → ${fmt(b)} (${d3.format('+.3f')(b-a)})`);
    const counts = [0, 0, 0];
    for (const cell of cells) counts[classify(changeUnits(cell, i, j))]++;
    const values = categories.map((d, k) => ({
      key:['lower','same','higher'][k], label:d.name, color:d.color,
      count:counts[k], share:counts[k] / cells.length
    }));
    d3.select('#summary-strip').selectAll('span').data(values.filter(d => d.count)).join('span')
      .style('background-color', d => d.color).style('flex', d => d.count);
    const items = d3.select('#summary-counts').selectAll('div').data(values).join(
      enter => {
        const item = enter.append('div');
        item.append('dt');
        item.append('dd');
        return item;
      }
    ).attr('class', d => d.key);
    items.select('dt').text(d => d.label);
    items.select('dd').text(d => percent(d.share))
      .attr('title', d => `${commas(d.count)} of ${commas(cells.length)} cells`);
    site('summary-caption').textContent = state.from === state.to
      ? `Both controls show ${state.to}, so all ${commas(cells.length)} cells have zero change.`
      : `Share of ${commas(cells.length)} cells; small change means within ±0.02 NDVI.`;
    site('status').textContent = `${state.to} minus ${state.from}: ${percent(values[0].share)} of cells lower, ${percent(values[2].share)} higher.`;
  }

  function drawTrend() {
    const featured = Boolean(cases[`${state.from}-${state.to}`]);
    const annual = state.mode === 'year';
    const activeYear = state.year;
    const c = state.selected;
    const local = c ? years.map((year, i) => ({year, value:cellValue(c, i)})) : null;
    const series = [{points:stateSeries, color:'#637d76', name:'California mean'}];
    if (local) series.push({points:local, color:'#1a6454', name:'Selected cell'});

    site('trend-title').textContent = c ? 'Cell vs. California' : 'California’s seasonal trend';
    site('selection-location').textContent = c ? coord(c) : 'Select a map cell to compare its history.';
    site('clear').hidden = !c;
    site('cell-key').hidden = !c;
    site('jump-to-trend').hidden = !c;
    site('trend-note').textContent = annual ? `The green marker shows ${activeYear}, the year on the map.` : state.from === state.to
      ? `Both controls show ${state.from}.`
      : featured
        ? 'Hollow points mark the drought year. Filled large points mark the wetter year.'
        : 'Hollow points mark the reference. Filled large points mark the comparison.';
    const values = site('selection-values');
    values.hidden = !c;
    if (c) {
      const shownYear = annual ? activeYear : state.to;
      const a = indexOf(state.from), b = indexOf(shownYear);
      const metrics = annual && shownYear === state.from ? [[`${shownYear} NDVI`, detailFmt(cellValue(c,b))]] :
        [[featured ? `${state.from} drought` : `Ref. ${state.from}`,detailFmt(cellValue(c,a))],
          [annual ? `${shownYear} on map` : featured ? `${shownYear} wetter` : `Compare ${shownYear}`,detailFmt(cellValue(c,b))],
          ['NDVI change',signed(changeUnits(c,a,b) / units)]];
      const cols = d3.select(values).selectAll('span').data(metrics).join('span').text(d => d[0]);
      cols.append('strong').text(d => d[1]);
    }

    const svg = d3.select('#trend');
    svg.selectAll('*').remove();
    svg.append('title').attr('id', 'trend-svg-title').text(site('trend-title').textContent);
    svg.append('desc').attr('id', 'trend-svg-desc')
      .text(`Seasonal NDVI from 2012 to 2023. ${c ? 'Selected cell and California mean.' : 'Mean across the analyzed cells.'} ${annual ? `The map shows ${activeYear}.` : `Reference year ${state.from}; comparison year ${state.to}.`}`);
    const x = d3.scaleLinear().domain(d3.extent(years)).range([49, 400]);
    const [min, max] = d3.extent(series.flatMap(s => s.points.map(d => d.value)));
    const pad = Math.max(.022, (max - min) * .10);
    const y = d3.scaleLinear().domain([Math.max(-1,min-pad), Math.min(1,max+pad)]).nice(4).range([180, 29]);
    svg.append('text').attr('x', 49).attr('y', 16).attr('fill','#455a50').text('Seasonal NDVI');
    svg.append('g').attr('class','y-axis').attr('transform','translate(49,0)')
      .call(d3.axisLeft(y).ticks(4).tickSize(-351).tickFormat(d3.format('.2f')));
    svg.append('g').attr('class','x-axis').attr('transform','translate(0,180)')
      .call(d3.axisBottom(x).tickValues([2012, 2015, 2018, 2021, 2023]).tickFormat(d3.format('d')).tickSizeOuter(0));

    const marked = annual ? [activeYear] : [...new Set([state.from,state.to])];
    svg.selectAll('line.year-marker').data(marked).join('line')
      .attr('class','year-marker').attr('x1', x).attr('x2', x)
      .attr('y1', 26).attr('y2', 180).attr('stroke',annual ? '#237064' : '#8fa499').attr('stroke-dasharray','3 3');

    const line = d3.line().x(d => x(d.year)).y(d => y(d.value));
    const plot = svg.selectAll('g.series').data(series).join('g').attr('class','series');
    plot.append('path').attr('fill','none').attr('stroke',d => d.color)
      .attr('stroke-width',2.4).attr('stroke-dasharray',d => d.name === 'California mean' ? '5 3' : null)
      .attr('d',d => line(d.points));
    plot.each(function(s) {
      d3.select(this).selectAll('circle').data(s.points).join('circle')
        .attr('cx',d => x(d.year)).attr('cy',d => y(d.value))
        .attr('r',d => marked.includes(d.year) ? 4.8 : 2)
        .attr('fill',d => !annual && d.year === state.from && state.from !== state.to ? '#fffefa' : s.color)
        .attr('stroke',s.color).attr('stroke-width',1.5);
    });

    const step = x(2013) - x(2012);
    svg.selectAll('rect.year-hit').data(years).join('rect').attr('class','year-hit')
      .attr('x', year => x(year) - step / 2).attr('y',22)
      .attr('width',step).attr('height',160).attr('fill','transparent').append('title')
      .text(year => `${year}: California ${fmt(stateSeries[indexOf(year)].value)}${c ? ` · Cell ${fmt(cellValue(c,indexOf(year)))}` : ''}`);
  }

  updateZoomButtons();
  drawScale();
  update(state.from, state.to);
})();
