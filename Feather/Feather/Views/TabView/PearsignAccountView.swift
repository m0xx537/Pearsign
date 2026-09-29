import SwiftUI

struct PearsignAccountView: View {
	@State private var email = ""
	@State private var password = ""
	@State private var isShowingNotice = false
	@FetchRequest(
		entity: CertificatePair.entity(),
		sortDescriptors: [NSSortDescriptor(keyPath: \CertificatePair.date, ascending: false)]
	) private var certificates: FetchedResults<CertificatePair>

	var body: some View {
		NBNavigationView("Account") {
			Form {
				Section {
					HStack(spacing: 14) {
						Image("PearsignLogo").resizable().scaledToFit().frame(width: 58, height: 58)
						VStack(alignment: .leading, spacing: 5) {
							Text("Pearsign Account").font(.title3.bold())
							Text("Connect your account to access purchased certificates.").font(.subheadline).foregroundStyle(.secondary)
						}
					}
					.padding(.vertical, 8)
				}
				Section("Sign in") {
					TextField("Email", text: $email).textContentType(.emailAddress).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
					SecureField("Password", text: $password).textContentType(.password)
					Button("Continue") { isShowingNotice = true }
						.disabled(email.isEmpty || password.isEmpty)
				}
				Section("On this device") {
					LabeledContent("Imported certificates", value: certificates.count.description)
					NavigationLink { NBNavigationView(.localized("Certificates")) { CertificatesView() } } label: { Text("Manage Certificates") }
				}
			}
			.alert("Pearsign sign-in isn’t connected yet", isPresented: $isShowingNotice) {
				Button("OK", role: .cancel) { }
			} message: {
				Text("Account authentication and certificate delivery need the Pearsign website API. Your credentials have not been sent or saved.")
			}
		}
	}
}
