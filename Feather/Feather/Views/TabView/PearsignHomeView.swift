import SwiftUI

struct PearsignHomeView: View {
	@FetchRequest(
		entity: CertificatePair.entity(),
		sortDescriptors: [NSSortDescriptor(keyPath: \CertificatePair.date, ascending: false)]
	) private var certificates: FetchedResults<CertificatePair>

	var body: some View {
		NBNavigationView("Home") {
			ScrollView {
				VStack(alignment: .leading, spacing: 24) {
					ZStack(alignment: .bottomLeading) {
						LinearGradient(
							colors: [Color(red: 0.20, green: 0.78, blue: 0.98), Color(red: 0.03, green: 0.31, blue: 0.94)],
							startPoint: .topLeading,
							endPoint: .bottomTrailing
						)
						.frame(height: 190)
						.overlay(alignment: .topTrailing) {
							Image("PearsignLogo")
								.resizable()
								.scaledToFit()
								.frame(width: 82, height: 82)
								.padding(18)
						}
						VStack(alignment: .leading, spacing: 6) {
							Text("PEARSIGN")
								.font(.caption.weight(.bold))
								.tracking(2)
								.opacity(0.8)
							Text("Your apps,\nyour way.")
								.font(.largeTitle.bold())
						}
						.foregroundStyle(.white)
						.padding(20)
					}
					.clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))

					VStack(alignment: .leading, spacing: 14) {
						Text("Get started").font(.title2.bold())
						NavigationLink { SourcesView() } label: {
							PearsignActionRow(icon: "globe.desk", title: "Browse Sources", subtitle: "Find apps from your repositories")
						}
						NavigationLink { NBNavigationView(.localized("Certificates")) { CertificatesView() } } label: {
							PearsignActionRow(icon: "person.text.rectangle", title: "Manage Certificates", subtitle: certificates.isEmpty ? "Import a certificate to start signing" : "\(certificates.count) certificate\(certificates.count == 1 ? "" : "s") ready")
						}
						NavigationLink { LibraryView() } label: {
							PearsignActionRow(icon: "square.grid.2x2", title: "Open Library", subtitle: "Sign and install your IPA files")
						}
					}
					.buttonStyle(.plain)
				}
				.padding()
			}
			.background(Color(uiColor: .systemGroupedBackground))
		}
	}
}

private struct PearsignActionRow: View {
	let icon: String
	let title: String
	let subtitle: String

	var body: some View {
		HStack(spacing: 14) {
			Image(systemName: icon)
				.font(.title3.weight(.semibold))
				.foregroundStyle(.white)
				.frame(width: 46, height: 46)
				.background(LinearGradient(colors: [Color.cyan, Color.blue], startPoint: .topLeading, endPoint: .bottomTrailing), in: RoundedRectangle(cornerRadius: 14))
			VStack(alignment: .leading, spacing: 4) {
				Text(title).font(.headline).foregroundStyle(.primary)
				Text(subtitle).font(.subheadline).foregroundStyle(.secondary)
			}
			Spacer()
			Image(systemName: "chevron.right").font(.caption.weight(.bold)).foregroundStyle(.tertiary)
		}
		.padding(14)
		.background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
	}
}
