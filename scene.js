const scene = document.getElementById('scene');
const timeInput = document.getElementById('time');
const timeDisplay = document.getElementById('time-display');
const waterline = parseFloat(getComputedStyle(scene).getPropertyValue('--waterline'));
const flareCenterY = (100 + waterline) / 2;

function smoothstep(start, end, value) {
  const fraction = Math.min(1, Math.max(0, (value - start) / (end - start)));
  return fraction * fraction * (3 - 2 * fraction);
}

function renderTime() {
  const minutes = timeInput.valueAsNumber;
  const angle = 2 * Math.PI * (minutes - 360) / 1440;
  const sunHeight = Math.sin(angle);
  const sunY = 61 - 46 * sunHeight;
  const orbitX = 17 * Math.cos(angle);
  const flareAngle = Math.atan2((flareCenterY - sunY) * 9 / 16, orbitX);
  const skyLight = smoothstep(-0.32, 0.54, sunHeight);
  const landscapeLight = smoothstep(-0.42, 0.24, sunHeight);
  const daylight = smoothstep(0.28, 0.78, sunHeight);
  const twilight = 1 - smoothstep(0.24, 0.75, sunHeight);
  const sunOpacity = smoothstep(-0.085, 0.05, sunHeight);

  const properties = {
    '--sun-x': `${50 - orbitX}%`,
    '--sun-y': `${sunY}%`,
    '--sun-height': Math.max(0, sunHeight),
    '--sun-flare-angle': `${flareAngle}rad`,
    '--moon-x': `${50 + orbitX}%`,
    '--moon-y': `${52 + 38 * sunHeight}%`,
    '--reflection-lean': `${0.85 * orbitX}deg`,
    '--sky-light': skyLight,
    '--landscape-light': landscapeLight,
    '--daylight': daylight,
    '--twilight': twilight,
    '--glow-opacity': smoothstep(-0.18, 0.08, sunHeight) * (0.32 + 0.58 * twilight),
    '--sun-opacity': sunOpacity,
    '--moon-opacity': 1 - smoothstep(-0.38, -0.04, sunHeight),
    '--stars-opacity': 1 - smoothstep(-0.42, 0.04, sunHeight),
  };

  for (const [name, value] of Object.entries(properties)) {
    scene.style.setProperty(name, value);
  }

  const hours = String(Math.floor(minutes / 60)).padStart(2, '0');
  const remainingMinutes = String(minutes % 60).padStart(2, '0');
  timeDisplay.value = `${hours}:${remainingMinutes}`;
  timeInput.setAttribute('aria-valuetext', timeDisplay.value);
}

timeInput.addEventListener('input', renderTime);
renderTime();

for (const checkbox of document.querySelectorAll('.layer-options input')) {
  const layer = document.getElementById(checkbox.value);
  const toggleLayer = () => {
    layer.hidden = !checkbox.checked;
  };

  checkbox.addEventListener('change', toggleLayer);
  toggleLayer();
}
