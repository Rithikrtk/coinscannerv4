/**
 * auth.js — CoinScanner Auth Page Logic
 * ========================================
 * Shared JavaScript for ALL auth pages:
 *   - login.html
 *   - signup.html
 *   - verify.html
 *   - change_password.html
 *   - reset_password.html
 *   - verify_reset_otp.html
 *
 * Loaded via base_auth.html for auth pages,
 * and via {% block extra_js %} for password pages.
 *
 * SECTIONS:
 *   1. Eye Toggle         — show/hide password fields
 *   2. Password Strength  — live strength meter as user types
 *   3. Password Match     — confirm password match hint
 *   4. Live Validation    — email format + phone format inline
 *   5. OTP Boxes          — 6-box OTP input with auto-advance
 *   6. OTP Countdown      — resend timer countdown
 */

document.addEventListener("DOMContentLoaded", function () {

  /* ══════════════════════════════════════════════════════
     1. EYE TOGGLE
     Any button with class .auth-eye-btn and data-target="inputId"
     toggles the input between password ↔ text.
     The icon switches between fa-eye and fa-eye-slash.
  ══════════════════════════════════════════════════════ */
  document.querySelectorAll(".auth-eye-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      // Find the input field this button controls
      const inputId = this.dataset.target;
      const input   = document.getElementById(inputId);
      const icon    = this.querySelector("i");
      if (!input) return;

      if (input.type === "password") {
        input.type        = "text";
        icon.className    = "fa-regular fa-eye-slash";
        this.title        = "Hide password";
      } else {
        input.type        = "password";
        icon.className    = "fa-regular fa-eye";
        this.title        = "Show password";
      }
    });
  });


  /* ══════════════════════════════════════════════════════
     2. PASSWORD STRENGTH METER
     Listens on any input with id="authPassword" or id="newPw".
     Updates a strength bar and label below the input.

     Scoring (0–4 points):
       +1 — at least 8 characters long
       +1 — contains a capital letter  (A-Z)
       +1 — contains a number          (0-9)
       +1 — contains a special char    (!@#$ etc)

     Levels:
       0 pts → (empty, no display)
       1 pt  → Weak    (red)
       2 pts → Fair    (orange)
       3 pts → Good    (yellow)
       4 pts → Strong  (green)
  ══════════════════════════════════════════════════════ */
  const strengthLevels = [
    { pct: "0%",   color: "#E2E8F0", text: ""        },  // 0 — empty
    { pct: "25%",  color: "#F87171", text: "Weak"     },  // 1 — poor
    { pct: "50%",  color: "#FB923C", text: "Fair"     },  // 2 — okay
    { pct: "75%",  color: "#FACC15", text: "Good"     },  // 3 — decent
    { pct: "100%", color: "#4ADE80", text: "Strong"   },  // 4 — great
  ];

  /**
   * Calculate password strength score (0–4).
   * @param {string} pw - the password to check
   * @returns {number} score from 0 to 4
   */
  function calcStrength(pw) {
    if (!pw) return 0;
    let score = 0;
    if (pw.length >= 8)           score++;   // length
    if (/[A-Z]/.test(pw))        score++;   // uppercase
    if (/[0-9]/.test(pw))        score++;   // number
    if (/[^A-Za-z0-9]/.test(pw)) score++;   // special char
    return score;
  }

  /**
   * Update the strength bar UI for a given password input.
   * @param {string} pw       - current password value
   * @param {string} fillId   - id of the fill bar element
   * @param {string} labelId  - id of the label text element
   */
  function updateStrengthBar(pw, fillId, labelId) {
    const fill  = document.getElementById(fillId);
    const label = document.getElementById(labelId);
    if (!fill || !label) return;

    const score = calcStrength(pw);
    const level = pw.length === 0 ? strengthLevels[0] : (strengthLevels[score] || strengthLevels[0]);

    fill.style.width      = level.pct;
    fill.style.background = level.color;
    fill.style.transition = "width 0.3s ease, background 0.3s ease";
    label.textContent     = level.text;
    label.style.color     = level.color;
  }

  // Signup page password field
  const signupPw = document.getElementById("authPassword");
  if (signupPw) {
    signupPw.addEventListener("input", function () {
      updateStrengthBar(this.value, "strengthFill", "strengthLabel");
      checkPasswordMatch();   // also update match hint if confirm is filled
    });
  }

  // Change/Reset password field
  const newPw = document.getElementById("newPw");
  if (newPw) {
    newPw.addEventListener("input", function () {
      updateStrengthBar(this.value, "strengthFill", "strengthLabel");
      checkPasswordMatch();
    });
  }


  /* ══════════════════════════════════════════════════════
     3. PASSWORD MATCH HINT
     Shows "✓ Passwords match" or "✗ Do not match" below
     the confirm password field as the user types.
  ══════════════════════════════════════════════════════ */
  /**
   * Compare password and confirm-password fields.
   * Updates the #matchHint element with a coloured message.
   */
  function checkPasswordMatch() {
    const hint    = document.getElementById("matchHint");
    if (!hint) return;

    // Try both signup (authPassword) and reset (newPw) field names
    const pw      = (document.getElementById("authPassword") || document.getElementById("newPw"))?.value || "";
    const confirm = document.getElementById("confirmPassword")?.value
                 || document.getElementById("confirmPw")?.value
                 || "";

    if (!confirm) {
      hint.textContent = "";
      return;
    }

    if (pw === confirm) {
      hint.textContent = "✓ Passwords match";
      hint.style.color = "#16A34A";   // green
    } else {
      hint.textContent = "✗ Passwords do not match";
      hint.style.color = "#DC2626";   // red
    }
  }

  // Listen on confirm password field
  const confirmPw = document.getElementById("confirmPassword") || document.getElementById("confirmPw");
  if (confirmPw) {
    confirmPw.addEventListener("input", checkPasswordMatch);
  }


  /* ══════════════════════════════════════════════════════
     4. LIVE VALIDATION
     Real-time inline feedback as the user types in the
     signup form. Shows green check or red X next to fields.

     Fields validated:
       - Email:  must match standard email pattern
       - Phone:  Indian mobile — 10 digits starting with 6-9
       - Name:   must be at least 2 characters
  ══════════════════════════════════════════════════════ */

  /**
   * Show or hide an inline validation message below a field.
   * @param {string} fieldId  - id of the input field
   * @param {boolean} valid   - whether the value is valid
   * @param {string} okMsg    - message to show when valid
   * @param {string} errMsg   - message to show when invalid
   */
  function setFieldFeedback(fieldId, valid, okMsg, errMsg) {
    const field   = document.getElementById(fieldId);
    const hint    = document.getElementById(fieldId + "Hint");
    if (!field || !hint) return;

    if (!field.value.trim()) {
      // Don't show error until user has typed something
      hint.textContent = "";
      field.classList.remove("valid", "invalid");
      return;
    }

    hint.textContent = valid ? okMsg : errMsg;
    hint.style.color = valid ? "#16A34A" : "#DC2626";
    field.classList.toggle("valid",   valid);
    field.classList.toggle("invalid", !valid);
  }

  // Email validation
  const emailField = document.getElementById("authEmail");
  if (emailField) {
    emailField.addEventListener("input", function () {
      // Basic email regex: something@something.something
      const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.value.trim());
      setFieldFeedback("authEmail", valid, "✓ Valid email", "✗ Enter a valid email address");
    });
  }

  // Phone validation (Indian: 10 digits, starts 6-9)
  const phoneField = document.getElementById("authPhone");
  if (phoneField) {
    phoneField.addEventListener("input", function () {
      // Remove spaces/dashes for checking, then validate
      const digits = this.value.replace(/\D/g, "");
      const valid  = digits.length === 10 && /^[6-9]/.test(digits);
      setFieldFeedback("authPhone", valid, "✓ Valid phone number", "✗ Enter a valid 10-digit Indian mobile number");
    });
  }

  // Name validation — letters and spaces only, min 2 chars
  const nameField = document.getElementById("authName");
  if (nameField) {
    nameField.addEventListener("input", function () {
      const val        = this.value.trim();
      const lettersOnly = /^[A-Za-z\s]+$/.test(val);
      const longEnough  = val.length >= 2;
      const valid       = lettersOnly && longEnough;
      const errMsg      = !longEnough
        ? "✗ Name must be at least 2 characters"
        : "✗ Name must contain letters only — no numbers or special characters";
      setFieldFeedback("authName", valid, "✓ Looks good", errMsg);
    });
  }


  /* ══════════════════════════════════════════════════════
     5. OTP BOXES
     6 individual single-digit input boxes that:
       - Auto-advance to next box when a digit is typed
       - Go back to previous box on Backspace
       - Support paste: pasting "123456" fills all boxes
       - Sync all 6 values into a hidden <input name="otp">
       - Enable the Submit button only when all 6 are filled
       - Auto-submit the form when all 6 digits are entered

     HTML needed:
       <div class="otp-boxes-wrap">
         <input class="otp-box" type="text" maxlength="1" inputmode="numeric">
         × 6
       </div>
       <input type="hidden" name="otp" id="otpHidden">
  ══════════════════════════════════════════════════════ */
  const otpBoxes  = document.querySelectorAll(".otp-box");
  const otpHidden = document.getElementById("otpHidden");
  const otpForm   = document.getElementById("otpForm");
  const otpSubmit = document.getElementById("otpSubmitBtn");

  if (otpBoxes.length === 6) {

    // Focus the first box automatically when page loads
    otpBoxes[0].focus();

    otpBoxes.forEach(function (box, index) {

      // Typing a digit → advance to next box
      box.addEventListener("input", function () {
        // Strip non-digits (just in case)
        this.value = this.value.replace(/[^0-9]/g, "");

        if (this.value && index < otpBoxes.length - 1) {
          otpBoxes[index + 1].focus();   // move to next
        }

        // Add 'filled' class for CSS styling (filled boxes get a blue border)
        this.classList.toggle("filled", !!this.value);
        syncOTPHidden();
      });

      // Backspace on empty box → go to previous box
      box.addEventListener("keydown", function (e) {
        if (e.key === "Backspace" && !this.value && index > 0) {
          otpBoxes[index - 1].value = "";
          otpBoxes[index - 1].classList.remove("filled");
          otpBoxes[index - 1].focus();
          syncOTPHidden();
        }
      });

      // Paste support: paste "123456" and all boxes fill instantly
      box.addEventListener("paste", function (e) {
        e.preventDefault();
        const pasted = (e.clipboardData || window.clipboardData)
          .getData("text")
          .replace(/\D/g, "")   // digits only
          .slice(0, 6);

        // Fill each box from the pasted string
        [...pasted].forEach(function (digit, i) {
          if (otpBoxes[i]) {
            otpBoxes[i].value = digit;
            otpBoxes[i].classList.add("filled");
          }
        });

        // Focus the box after the last filled one
        const nextIndex = Math.min(pasted.length, 5);
        otpBoxes[nextIndex].focus();
        syncOTPHidden();
      });

    });

    /**
     * Sync all 6 box values into the hidden input,
     * and enable/disable the submit button.
     * Also auto-submits when all 6 digits are filled.
     */
    function syncOTPHidden() {
      const otp = [...otpBoxes].map(function (b) { return b.value; }).join("");
      if (otpHidden) otpHidden.value = otp;

      const allFilled = otp.length === 6;

      // Enable/disable submit button
      if (otpSubmit) {
        otpSubmit.disabled     = !allFilled;
        otpSubmit.style.opacity = allFilled ? "1" : "0.5";
      }

      // Auto-submit when all 6 are filled (better UX)
      if (allFilled && otpForm) {
        setTimeout(function () {
          otpForm.submit();
        }, 120);   // tiny delay so user sees the last digit before submit
      }
    }

    // Safety net: sync hidden input on form submit (in case auto-submit is bypassed)
    if (otpForm) {
      otpForm.addEventListener("submit", function (e) {
        const otp = [...otpBoxes].map(function (b) { return b.value; }).join("");
        if (otpHidden) otpHidden.value = otp;
        if (otp.length < 6) {
          e.preventDefault();   // block submit if incomplete
        }
      });
    }

  } // end if(otpBoxes.length === 6)


  /* ══════════════════════════════════════════════════════
     6. OTP COUNTDOWN TIMER
     Shows "Resend in Xs" then enables the Resend button
     after 60 seconds.

     HTML needed:
       <span id="timerText">Resend in <strong id="timerCount">60</strong>s</span>
       <button id="resendOtpBtn" disabled>Resend OTP</button>
  ══════════════════════════════════════════════════════ */
  const timerCount  = document.getElementById("timerCount");
  const timerText   = document.getElementById("timerText");
  const resendBtn   = document.getElementById("resendOtpBtn");

  if (timerCount && resendBtn) {
    let seconds = 60;

    const countdown = setInterval(function () {
      seconds--;
      timerCount.textContent = seconds;

      if (seconds <= 0) {
        clearInterval(countdown);
        // Hide the "Resend in Xs" text and enable the Resend button
        if (timerText)  timerText.style.display = "none";
        resendBtn.disabled = false;
        resendBtn.style.opacity = "1";
      }
    }, 1000);   // runs every 1 second
  }

}); // end DOMContentLoaded
