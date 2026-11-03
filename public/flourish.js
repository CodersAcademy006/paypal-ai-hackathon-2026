// Decoration only: a small hand-drawn-looking brush underline below the h1,
// p5.js noise-jittered strokes rather than a plain <hr>. Purely cosmetic —
// never touches app state, fails silently if p5 doesn't load.
if (window.p5) {
  new p5((sketch) => {
    sketch.setup = () => {
      const canvas = document.getElementById("flourish");
      sketch.createCanvas(canvas.width, canvas.height, canvas);
      sketch.noLoop();
      sketch.stroke(20, 20, 20);
      sketch.strokeWeight(3);
      sketch.noFill();
      sketch.beginShape();
      for (let x = 0; x <= canvas.width; x += 6) {
        const y = canvas.height / 2 + sketch.noise(x * 0.08) * 10 - 5;
        sketch.vertex(x, y);
      }
      sketch.endShape();
    };
  });
}
