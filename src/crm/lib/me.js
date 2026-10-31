// The signed-in person's display name. Their board is private, so "a person" as an event owner
// is always them; the UI shows their name where the original design showed "Abhinav".
let me = 'Me'
export const setMe = (name) => {
  me = name || 'Me'
}
export const getMe = () => me
