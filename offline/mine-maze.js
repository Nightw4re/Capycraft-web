(() => {
  const play = document.querySelector('#play-maze');
  const dialog = document.querySelector('#mine-maze');
  const board = document.querySelector('#maze-board');
  const status = document.querySelector('#maze-status');
  const context = board.getContext('2d');
  if (!context || typeof dialog.showModal !== 'function') return;

  const mine = [
    '#############',
    '#S..#..D...E#',
    '#.#.#.###.#.#',
    '#.D.......#.#',
    '###.###.###.#',
    '#D..#D..#...#',
    '#.#.#.#.#.#.#',
    '#.....D...D.#',
    '#.###.#.###.#',
    '#...D.#...D.#',
    '#############',
  ];
  const directions = {
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
  };
  const diamonds = [];
  mine.forEach((row, y) => {
    for (const [x, tile] of [...row].entries()) {
      if (tile === 'D') diamonds.push(y * row.length + x);
    }
  });

  let player;
  let carts;
  let remaining;
  let direction;
  let nextDirection;
  let timer;
  let ticks;
  let swipe;
  let finished;

  function draw() {
    mine.forEach((row, y) => {
      for (const [x, tile] of [...row].entries()) {
        const left = x * 16;
        const top = y * 16;
        const block = (dx, dy, width, height, color) => {
          context.fillStyle = color;
          context.fillRect(left + dx, top + dy, width, height);
        };
        block(0, 0, 16, 16, (x + y) % 2 ? '#302b36' : '#352f3b');
        if (tile === '#') {
          block(0, 0, 15, 15, '#5e5261');
          block(0, 0, 15, 2, '#796979');
          block(3, 6, 5, 2, '#6a5b6c');
          block(9, 11, 4, 2, '#4b404f');
        }
        if (carts.some(cart => y === cart.y && x >= cart.min && x <= cart.max)) {
          block(6, 3, 3, 10, '#775746');
          block(0, 4, 16, 1, '#b09383');
          block(0, 11, 16, 1, '#b09383');
        }
        if (tile === 'E') {
          block(2, 1, 12, 14, '#8d6243');
          block(4, 3, 8, 12, remaining.size ? '#49343a' : '#89e6a1');
          if (remaining.size) block(5, 8, 6, 2, '#e0ad65');
        }
        if (remaining.has(y * row.length + x)) {
          block(5, 3, 6, 2, '#b7ffff');
          block(3, 5, 10, 4, '#49dfec');
          block(5, 9, 6, 2, '#20aabf');
          block(7, 11, 2, 2, '#20aabf');
          block(6, 5, 4, 3, '#91f7ff');
        }
        if (carts.some(cart => cart.x === x && cart.y === y)) {
          block(1, 4, 14, 8, '#a6a2af');
          block(1, 4, 14, 2, '#e4bd82');
          block(3, 6, 10, 4, '#5c5261');
          block(3, 12, 3, 2, '#17151c');
          block(10, 12, 3, 2, '#17151c');
        }
        if (player.x === x && player.y === y) {
          block(1, 6, 10, 7, '#aa663f');
          block(7, 4, 6, 8, '#d69861');
          block(12, 7, 3, 5, '#e4ab76');
          block(8, 2, 2, 3, '#aa663f');
          block(11, 6, 1, 1, '#241b23');
          block(14, 8, 1, 1, '#573827');
          block(3, 12, 2, 2, '#d69861');
          block(8, 12, 2, 2, '#d69861');
        }
      }
    });
  }

  function reportDiamonds() {
    const count = `${diamonds.length - remaining.size} / ${diamonds.length}`;
    status.textContent = remaining.size ? status.dataset.diamonds.replace('{count}', count) : status.dataset.exit;
  }

  function tileAhead([dx, dy]) {
    return mine[player.y + dy]?.[player.x + dx];
  }

  function canMove(vector) {
    const tile = vector && tileAhead(vector);
    return tile && tile !== '#' && (tile !== 'E' || !remaining.size);
  }

  function finish(message) {
    clearInterval(timer);
    finished = true;
    status.textContent = message;
  }

  function step() {
    if (!dialog.open || document.hidden || finished) return;
    if (canMove(nextDirection)) {
      direction = nextDirection;
      nextDirection = undefined;
    }
    const previousX = player.x;
    const previousY = player.y;
    if (canMove(direction)) {
      player.x += direction[0];
      player.y += direction[1];
    }
    ticks += 1;
    let hit = false;
    for (const cart of carts) {
      const oldX = cart.x;
      if (ticks % 2 === 0) {
        if (cart.x + cart.speed < cart.min || cart.x + cart.speed > cart.max) cart.speed *= -1;
        cart.x += cart.speed;
      }
      const swapped = previousY === cart.y && previousX === cart.x && player.x === oldX;
      hit ||= player.y === cart.y && (player.x === cart.x || swapped);
    }
    const tile = mine[player.y][player.x];
    if (remaining.delete(player.y * mine[0].length + player.x)) reportDiamonds();
    draw();
    if (hit) finish(status.dataset.hit);
    else if (tile === 'E') finish(status.dataset.win);
  }

  function reset() {
    clearInterval(timer);
    player = { x: 1, y: 1 };
    carts = [
      { x: 8, y: 3, min: 2, max: 9, speed: -1 },
      { x: 4, y: 7, min: 1, max: 11, speed: 1 },
    ];
    remaining = new Set(diamonds);
    direction = nextDirection = swipe = undefined;
    ticks = 0;
    finished = false;
    reportDiamonds();
    draw();
  }

  function steer(vector) {
    if (finished) return;
    nextDirection = vector;
    if (!ticks && canMove(vector)) {
      step();
      timer = setInterval(step, 175);
    }
  }

  play.addEventListener('click', () => {
    reset();
    dialog.showModal();
  });
  document.querySelector('#restart-maze').addEventListener('click', reset);
  dialog.addEventListener('close', () => {
    clearInterval(timer);
    swipe = undefined;
  });
  dialog.addEventListener('keydown', event => {
    if (!Object.hasOwn(directions, event.key)) return;
    event.preventDefault();
    steer(directions[event.key]);
  });
  board.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0) return;
    swipe = { id: event.pointerId, x: event.clientX, y: event.clientY };
    board.setPointerCapture(event.pointerId);
  });
  board.addEventListener('pointermove', event => {
    if (swipe?.id !== event.pointerId) return;
    const dx = event.clientX - swipe.x;
    const dy = event.clientY - swipe.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 12) return;
    swipe.x = event.clientX;
    swipe.y = event.clientY;
    steer(Math.abs(dx) > Math.abs(dy) ? [Math.sign(dx), 0] : [0, Math.sign(dy)]);
  });
  board.addEventListener('lostpointercapture', event => {
    if (swipe?.id === event.pointerId) swipe = undefined;
  });
  play.hidden = false;
})();
