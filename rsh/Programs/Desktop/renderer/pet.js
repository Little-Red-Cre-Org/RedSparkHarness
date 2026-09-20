/** Render only validated presentation data delivered by the shell. */
const pet = document.getElementById('pet')
const status = document.getElementById('status')
const dispose = window.desktopPet.subscribe(state => {
  pet.style.backgroundImage = `url(${JSON.stringify(state.atlasUrl)})`
  pet.style.backgroundPosition = `${state.frame * 100 / 3}% 0`
  pet.setAttribute('aria-label', state.label)
  status.textContent = state.label
})
window.addEventListener('unload', dispose, { once: true })
